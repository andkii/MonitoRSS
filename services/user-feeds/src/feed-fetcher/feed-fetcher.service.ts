import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Dispatcher, request } from "undici";
import BodyReadable from "undici/types/readable";
import { ArticlesService } from "../articles/articles.service";
import { FeedResponseRequestStatus, UserFeedFormatOptions } from "../shared";
import {
  FeedArticleNotFoundException,
  FeedRequestBadStatusCodeException,
  FeedRequestFetchException,
  FeedRequestInternalException,
  FeedRequestNetworkException,
  FeedRequestParseException,
  FeedRequestServerStatusException,
  FeedRequestTimedOutException,
} from "./exceptions";
import { FeedResponse } from "./types";
import pRetry from "p-retry";
import { ClientGrpc } from "@nestjs/microservices/interfaces";
import { lastValueFrom, Observable } from "rxjs";
import logger from "../shared/utils/logger";
import { Metadata } from "@grpc/grpc-js";

interface FetchFeedArticleOptions {
  formatOptions: UserFeedFormatOptions;
}

@Injectable()
export class FeedFetcherService implements OnModuleInit {
  SERVICE_HOST: string;
  API_KEY: string;
  feedFetcherGrpcPackage: any;

  constructor(
    private readonly configService: ConfigService,
    private readonly articlesService: ArticlesService,
    @Inject("FEED_FETCHER_PACKAGE") private client: ClientGrpc
  ) {
    this.SERVICE_HOST = configService.getOrThrow(
      "USER_FEEDS_FEED_REQUESTS_API_URL"
    );
    this.API_KEY = configService.getOrThrow("USER_FEEDS_FEED_REQUESTS_API_KEY");
  }

  onModuleInit() {
    this.feedFetcherGrpcPackage = this.client.getService("FeedFetcherGrpc");
  }

  async fetch(
    url: string,
    options?: {
      executeFetchIfNotInCache?: boolean;
      retries?: number;
    }
  ) {
    const serviceUrl = this.SERVICE_HOST;
    let statusCode: number;
    let body: BodyReadable & Dispatcher.BodyMixin;

    try {
      ({ statusCode, body } = await pRetry(
        async () =>
          request(serviceUrl, {
            method: "POST",
            body: JSON.stringify({
              url,
              executeFetchIfNotExists:
                options?.executeFetchIfNotInCache ?? false,
            }),
            headers: {
              "content-type": "application/json",
              accept: "application/json",
              "api-key": this.API_KEY,
            },
          }),
        {
          retries: options?.retries ?? 5,
          randomize: true,
        }
      ));
    } catch (err) {
      throw new FeedRequestNetworkException(
        `Failed to execute request to feed requests API: ${
          (err as Error).message
        }`
      );
    }

    return this.handleFetchResponse({
      statusCode,
      json: body.json.bind(body),
    });
  }

  async fetchWithGrpc(
    url: string,
    options?: {
      executeFetchIfNotInCache?: boolean;
      retries?: number;
    }
  ) {
    try {
      const metadata = new Metadata();
      metadata.add("api-key", this.API_KEY);
      metadata.add("grpc-target", "feed-requests");
      const observable: Observable<string> =
        await this.feedFetcherGrpcPackage.fetchFeed(
          {
            url,
            executeFetchIfNotExists: options?.executeFetchIfNotInCache ?? false,
          },
          metadata
        );

      const lastVal = await lastValueFrom(observable);

      return this.handleFetchResponse({
        statusCode: 200,
        json: async () => lastVal,
      });
    } catch (err) {
      logger.error(`Failed to execute GRPC request to feed requests API`, {
        grpcErrorMessage: (err as any).message,
        code: (err as any).code,
        details: (err as any).details,
      });

      throw err;
    }
  }

  async fetchFeedArticles(
    url: string,
    { formatOptions }: FetchFeedArticleOptions
  ) {
    const feedXml = await this.fetch(url, {
      executeFetchIfNotInCache: true,
    });

    if (!feedXml) {
      return null;
    }

    return this.articlesService.getArticlesFromXml(feedXml, {
      formatOptions,
    });
  }

  async fetchFeedArticle(
    url: string,
    id: string,
    { formatOptions }: FetchFeedArticleOptions
  ) {
    const result = await this.fetchFeedArticles(url, {
      formatOptions,
    });

    if (!result) {
      throw new Error(`Request for ${url} is still pending`);
    }

    const { articles } = result;

    if (!articles.length) {
      return null;
    }

    const article = articles.find((article) => article.flattened.id === id);

    if (!article) {
      throw new FeedArticleNotFoundException(
        `Article with id ${id} for url ${url} not found`
      );
    }

    return article;
  }

  async fetchRandomFeedArticle(
    url: string,
    { formatOptions }: FetchFeedArticleOptions
  ) {
    const result = await this.fetchFeedArticles(url, {
      formatOptions,
    });

    if (!result) {
      throw new Error(`Request for ${url} is still pending`);
    }

    if (!result.articles.length) {
      return null;
    }

    const { articles } = result;

    return articles[Math.floor(Math.random() * articles.length)];
  }

  private async handleFetchResponse({
    statusCode,
    json,
  }: {
    statusCode: number;
    json: () => Promise<unknown>;
  }) {
    if (statusCode < 200 || statusCode >= 300) {
      let bodyJson: unknown = {};

      try {
        bodyJson = await json();
      } catch (err) {}

      throw new FeedRequestServerStatusException(
        `Bad status code for ${
          this.SERVICE_HOST
        } (${statusCode}) (${JSON.stringify(bodyJson)}).`
      );
    }

    const response = (await json()) as FeedResponse;

    const { requestStatus } = response;

    if (requestStatus === FeedResponseRequestStatus.InternalError) {
      throw new FeedRequestInternalException(
        `Feed requests service encountered internal error while fetching feed`
      );
    }

    if (requestStatus === FeedResponseRequestStatus.ParseError) {
      throw new FeedRequestParseException(`Invalid feed`);
    }

    if (requestStatus === FeedResponseRequestStatus.FetchError) {
      throw new FeedRequestFetchException(
        "Fetch on user feeds service failed, likely a network error"
      );
    }

    if (requestStatus === FeedResponseRequestStatus.BadStatusCode) {
      throw new FeedRequestBadStatusCodeException(
        `Bad status code received for feed request (${response.response.statusCode})`,
        response.response.statusCode
      );
    }

    if (requestStatus === FeedResponseRequestStatus.Pending) {
      return null;
    }

    if (requestStatus === FeedResponseRequestStatus.Success) {
      return response.response.body;
    }

    if (requestStatus === FeedResponseRequestStatus.FetchTimeout) {
      throw new FeedRequestTimedOutException(`Feed request timed out`);
    }

    throw new Error(
      `Unexpected feed request status in response: ${requestStatus}`
    );
  }
}
