import {
  Button,
  Card,
  CardFooter,
  CardHeader,
  Badge,
  Box,
  Flex,
  HStack,
  Stack,
  Text,
} from "@chakra-ui/react";
import { ChevronRightIcon } from "@chakra-ui/icons";
import { Link as RouterLink } from "react-router-dom";
import { UserFeed } from "../../../feed/types";
import {
  FeedConnectionDisabledCode,
  FeedConnectionType,
  FeedDiscordChannelConnection,
} from "../../../../types";
import { DiscordChannelName } from "../../../discordServers";
import getChakraColor from "../../../../utils/getChakraColor";
import { pages } from "../../../../constants";
import { DiscordChannelConnectionSettings } from "./DiscordChannelConnectionSettings";

interface Props {
  feedId: string;
  connection: UserFeed["connections"][number];
}

function getPrettyConnectionName(connection: FeedDiscordChannelConnection) {
  const { key } = connection;

  if (key === FeedConnectionType.DiscordChannel) {
    const casted = connection as FeedDiscordChannelConnection;

    if (casted.details.channel) {
      if (casted.details.channel.type === "thread") {
        return "Discord Thread";
      }

      if (casted.details.channel.type === "forum") {
        return "Discord Forum";
      }

      return "Discord Channel";
    }

    if (casted.details.webhook) {
      if (casted.details.webhook.type === "forum") {
        return "Discord Forum Webhook";
      }

      if (casted.details.webhook.type === "thread") {
        return "Discord Thread Webhook";
      }

      return "Discord Channel Webhook";
    }
  }

  return "Unknown";
}

const getPrettyConnectionDetail = (connection: FeedDiscordChannelConnection) => {
  const { key } = connection;

  if (key === FeedConnectionType.DiscordChannel) {
    const casted = connection as FeedDiscordChannelConnection;

    if (casted.details.channel) {
      if (casted.details.channel.type === "thread") {
        return null;
      }

      return (
        <DiscordChannelName
          channelId={casted.details.channel.id}
          serverId={casted.details.channel.guildId}
          spinnerSize="xs"
          textProps={{
            color: "gray.500",
            fontSize: 14,
          }}
          parenthesis
        />
      );
    }
  }

  return null;
};

const DISABLED_CODES_FOR_ERROR = [
  FeedConnectionDisabledCode.MissingMedium,
  FeedConnectionDisabledCode.MissingPermissions,
  FeedConnectionDisabledCode.BadFormat,
];

export const ConnectionCard = ({ feedId, connection }: Props) => {
  const isError = DISABLED_CODES_FOR_ERROR.includes(
    connection.disabledCode as FeedConnectionDisabledCode
  );

  let cardLeftBorder = "";

  if (isError) {
    cardLeftBorder = `solid 3px ${getChakraColor("red.400")}`;
  } else if (connection.disabledCode === FeedConnectionDisabledCode.Manual) {
    cardLeftBorder = `solid 3px ${getChakraColor("gray.400")}`;
  }

  const connectionDetail = getPrettyConnectionDetail(connection as never);

  return (
    <Card
      key={connection.id}
      variant="elevated"
      size="sm"
      borderLeft={cardLeftBorder}
      rounded="lg"
      paddingX={1}
    >
      <CardHeader>
        <HStack justifyContent="space-between" alignItems="flex-start">
          <Stack spacing="1">
            <Flex alignItems="center" gap={2}>
              <Text color="gray.500" fontSize="sm">
                {getPrettyConnectionName(connection as never)}
              </Text>
              {connectionDetail ? <> {connectionDetail}</> : null}
            </Flex>
            <HStack>
              <Text fontWeight={600}>{connection.name}</Text>
              {connection.disabledCode === FeedConnectionDisabledCode.Manual && (
                <Badge fontSize="x-small" colorScheme="gray">
                  Disabled
                </Badge>
              )}
              {isError && (
                <Badge fontSize="x-small" colorScheme="red">
                  Error
                </Badge>
              )}
            </HStack>
          </Stack>
          {connection.key === FeedConnectionType.DiscordChannel && (
            <DiscordChannelConnectionSettings
              connection={connection as FeedDiscordChannelConnection}
              feedId={feedId}
            />
          )}
        </HStack>
      </CardHeader>
      <CardFooter justifyContent="space-between">
        <Box />
        <Button
          as={RouterLink}
          to={pages.userFeedConnection({
            feedId: feedId as string,
            connectionType: connection.key,
            connectionId: connection.id,
          })}
          rightIcon={<ChevronRightIcon />}
        >
          Manage
        </Button>
      </CardFooter>
    </Card>
  );
};
