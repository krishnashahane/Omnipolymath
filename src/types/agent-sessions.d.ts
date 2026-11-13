// Declares extension points for agent session type augmentation.
export type OmnipolymathAgentSessionSkillSourceAugmentation = never;

declare module "omnipolymath/plugin-sdk/agent-sessions" {
  interface Skill {
    // Omnipolymath relies on the source identifier returned by skill loaders.
    source: string;
  }
}
