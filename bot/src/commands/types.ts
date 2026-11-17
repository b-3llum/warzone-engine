import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";

export interface Command {
  /** Slash command definition sent to Discord by deploy-commands. */
  data: { name: string; toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

/** Handles component/modal interactions whose customId starts with `prefix:`. */
export interface ComponentHandler {
  prefix: string;
  button?(interaction: ButtonInteraction, args: string[]): Promise<void>;
  modal?(interaction: ModalSubmitInteraction, args: string[]): Promise<void>;
}
