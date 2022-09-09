import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "./../src/app.module";
import {
  setupIntegrationTests,
  teardownIntegrationTests,
} from "../src/shared/utils/setup-integration-tests";
import { FeedEventHandlerService } from "../src/feed-event-handler/feed-event-handler.service";
import { FeedArticleField } from "../src/articles/entities";
import { EntityManager, EntityRepository } from "@mikro-orm/core";
import { FeedV2Event } from "../src/feed-event-handler/types";
import { Interceptable, MockAgent, setGlobalDispatcher } from "undici";
import { readFileSync } from "fs";
import { join } from "path";
import { ConfigService } from "@nestjs/config";

const feedId = "feed-id";
const feedHost = "https://feed.com";
const feedPath = "/rss";

const feedText = readFileSync(
  join(__dirname, "data", "rss-2-feed.xml"),
  "utf-8"
);

describe("App (e2e)", () => {
  let feedEventHandler: FeedEventHandlerService;
  let configService: ConfigService;
  let articlesRepo: EntityRepository<FeedArticleField>;
  let client: Interceptable;

  beforeAll(async () => {
    const { init } = await setupIntegrationTests({
      imports: [AppModule],
    });

    const { module } = await init();
    feedEventHandler = module.get(FeedEventHandlerService);
    configService = module.get(ConfigService);
    const em = module.get(EntityManager);
    articlesRepo = em.getRepository(FeedArticleField);
  });

  beforeEach(() => {
    const agent = new MockAgent();
    agent.disableNetConnect();
    client = agent.get(configService.getOrThrow("FEED_REQUEST_SERVICE_URL"));
    setGlobalDispatcher(agent);
  });

  afterAll(async () => {
    await teardownIntegrationTests();
  });

  it("sends new articles", async () => {
    const event: FeedV2Event = {
      article: {
        id: feedId,
        blockingComparisons: [],
        passingComparisons: [],
        url: feedHost + feedPath,
      },
    };

    // Pre-initialize the database with articles of this feed
    await articlesRepo.nativeInsert({
      id: -1,
      feed_id: feedId,
      created_at: new Date(),
      field_name: "id",
      field_value: "some-random-id",
    });

    client
      .intercept({
        path: "/requests",
        method: "POST",
      })
      .reply(200, {
        requestStatus: "success",
        response: {
          body: feedText,
        },
      });

    const articles = await feedEventHandler.handleV2Event(event);
    expect(articles).toHaveLength(28);
  });
});
