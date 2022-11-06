import { NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  setupEndpointTests,
  teardownEndpointTests,
} from "../../utils/endpoint-tests";
import { MongooseTestModule } from "../../utils/mongoose-test.module";
import nock from "nock";
import { CACHE_MANAGER, HttpStatus } from "@nestjs/common";
import { Session } from "../../common";
import { getModelToken } from "@nestjs/mongoose";
import path from "path";
import { Cache } from "cache-manager";
import { readFileSync } from "fs";
import { ApiErrorCode } from "../../common/constants/api-errors";
import { UserFeedsModule } from "./user-feeds.module";
import { UserFeed, UserFeedModel } from "./entities";
import { CreateUserFeedInputDto } from "./dto";
import { ConfigService } from "@nestjs/config";
import { DiscordAuthService } from "../discord-auth/discord-auth.service";

const feedXml = readFileSync(
  path.join(__dirname, "../../test/data/feed.xml"),
  "utf-8"
);

jest.mock("../../utils/logger");

describe("UserFeedsModule", () => {
  let app: NestFastifyApplication;
  let userFeedModel: UserFeedModel;
  let feedFetcherApiHost: string;
  let setAccessToken: (accessToken: Session["accessToken"]) => Promise<string>;
  const standardRequestOptions = {
    headers: {
      cookie: "",
    },
  };
  let discordAuthService: DiscordAuthService;
  const mockDiscordUser = {
    id: "discord-user-id",
  };

  beforeAll(async () => {
    const { init, uncompiledModule } = setupEndpointTests({
      imports: [UserFeedsModule, MongooseTestModule.forRoot()],
    });

    uncompiledModule
      .overrideProvider(DiscordAuthService)
      .useValue(discordAuthService);

    ({ app, setAccessToken } = await init());

    standardRequestOptions.headers.cookie = await setAccessToken({
      access_token: "accessToken",
    } as Session["accessToken"]);

    userFeedModel = app.get<UserFeedModel>(getModelToken(UserFeed.name));
    discordAuthService = app.get<DiscordAuthService>(DiscordAuthService);
    feedFetcherApiHost = app
      .get(ConfigService)
      .getOrThrow<string>("FEED_FETCHER_API_HOST");
  });

  beforeEach(() => {
    jest
      .spyOn(discordAuthService, "getUser")
      .mockResolvedValue(mockDiscordUser as never);
  });

  afterEach(async () => {
    jest.resetAllMocks();
    nock.cleanAll();
    await userFeedModel?.deleteMany({});

    const cacheManager = app.get<Cache>(CACHE_MANAGER);
    cacheManager.reset();
  });

  afterAll(async () => {
    await teardownEndpointTests();
  });

  describe("POST /user-feeds", () => {
    const validBody: CreateUserFeedInputDto = {
      title: "title",
      url: "https://www.feed.com",
    };

    it("returns 401 if not logged in with discord", async () => {
      const { statusCode } = await app.inject({
        method: "POST",
        url: `/user-feeds`,
        payload: validBody,
      });

      expect(statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it("returns the correct error codes for feed request-related errors", async () => {
      nock(feedFetcherApiHost)
        .post("/requests")
        .reply(200, {
          requestStatus: "success",
          response: {
            statusCode: 429,
          },
        });

      const { statusCode, body } = await app.inject({
        method: "POST",
        url: `/user-feeds`,
        payload: validBody,
        ...standardRequestOptions,
      });

      expect(JSON.parse(body)).toMatchObject({
        code: ApiErrorCode.FEED_REQUEST_TOO_MANY_REQUESTS,
      });
      expect(statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it("returns created feed details on success", async () => {
      nock(feedFetcherApiHost)
        .post("/requests")
        .reply(200, {
          requestStatus: "success",
          response: {
            statusCode: 200,
            body: feedXml,
          },
        });

      const { statusCode, body } = await app.inject({
        method: "POST",
        url: `/user-feeds`,
        payload: validBody,
        ...standardRequestOptions,
      });

      expect(JSON.parse(body)).toMatchObject({
        result: {
          title: "title",
          url: "https://www.feed.com",
          id: expect.any(String),
        },
      });
      expect(statusCode).toBe(HttpStatus.CREATED);
    });
  });

  describe("DELETE /:feedId", () => {
    let feed: UserFeed;

    beforeEach(async () => {
      feed = await userFeedModel.create({
        title: "title",
        url: "https://www.feed.com",
        user: {
          discordUserId: mockDiscordUser.id,
        },
      });
    });

    it("returns 401 if not logged in with discord", async () => {
      const { statusCode } = await app.inject({
        method: "DELETE",
        url: `/user-feeds/${feed._id}`,
      });

      expect(statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it("returns 404 if feed does not exist", async () => {
      const { statusCode } = await app.inject({
        method: "DELETE",
        url: `/user-feeds/123`,
        ...standardRequestOptions,
      });

      expect(statusCode).toBe(HttpStatus.NOT_FOUND);
    });

    it("returns 403 if feed does not belong to user", async () => {
      jest.spyOn(discordAuthService, "getUser").mockResolvedValue({
        id: mockDiscordUser + "-other",
      } as never);

      const { statusCode } = await app.inject({
        method: "DELETE",
        url: `/user-feeds/${feed._id}`,
        ...standardRequestOptions,
      });

      expect(statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it("returns 204 on success", async () => {
      const { statusCode } = await app.inject({
        method: "DELETE",
        url: `/user-feeds/${feed._id}`,
        ...standardRequestOptions,
      });

      expect(statusCode).toBe(HttpStatus.NO_CONTENT);
    });
  });
});
