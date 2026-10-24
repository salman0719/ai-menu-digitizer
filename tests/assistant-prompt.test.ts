import { describe, expect, it } from "vitest";

import { CAPABILITY_CARD } from "@/features/assistant/capability-card";
import {
  MAX_CONTEXT_MENUS,
  MAX_CONTEXT_RESTAURANTS,
  buildAccountContext,
  buildAssistantMessages,
  buildAssistantSystemPrompt,
  sanitizePromptText,
  type AssistantContextRestaurant,
} from "@/lib/ai/assistant/prompt";

describe("sanitizePromptText", () => {
  it("strips control characters, collapses whitespace and trims", () => {
    expect(sanitizePromptText("  Chicken\u0000\n\t burger  ", 100)).toBe("Chicken burger");
  });

  it("truncates to the budget", () => {
    expect(sanitizePromptText("a".repeat(50), 10)).toBe("a".repeat(10));
  });
});

describe("buildAccountContext", () => {
  it("says so when the account has no restaurants yet", () => {
    expect(buildAccountContext([])).toContain("no restaurants yet");
  });

  it("lists names, roles and menu titles", () => {
    const context = buildAccountContext([
      { name: "Bistro Four", role: "owner", menus: [{ title: "Lunch" }, { title: "Dinner" }] },
    ]);
    expect(context).toContain("Bistro Four (owner)");
    expect(context).toContain('"Lunch", "Dinner"');
  });

  it("caps restaurants and menus so a large account cannot fill the prompt", () => {
    const restaurants: AssistantContextRestaurant[] = Array.from(
      { length: MAX_CONTEXT_RESTAURANTS + 5 },
      (_, index) => ({
        name: `Restaurant ${index + 1}`,
        role: "owner" as const,
        menus: Array.from({ length: 10 }, (_, menuIndex) => ({
          title: `Menu ${index + 1}.${menuIndex + 1}`,
        })),
      })
    );
    const context = buildAccountContext(restaurants);
    const menuMentions = context.match(/Menu \d+\.\d+/g) ?? [];
    expect(context).not.toContain(`Restaurant ${MAX_CONTEXT_RESTAURANTS + 1}`);
    expect(menuMentions.length).toBeLessThanOrEqual(MAX_CONTEXT_MENUS);
  });
});

describe("buildAssistantSystemPrompt", () => {
  it("carries the capability card, the rules and the delimited account block", () => {
    const prompt = buildAssistantSystemPrompt([
      { name: "Bistro Four", role: "owner", menus: [{ title: "Lunch" }] },
    ]);
    expect(prompt).toContain("Not available anywhere in Eateryo");
    expect(prompt).toContain("Answer only from the feature list");
    expect(prompt).toContain("<account-context>");
    expect(prompt).toContain("Bistro Four (owner)");
    expect(prompt).toContain("</account-context>");
  });

  it("uses screen-level paths the owner can actually follow", () => {
    expect(CAPABILITY_CARD).toContain("Editor → Preview");
    expect(CAPABILITY_CARD).toContain("Editor → availability");
  });
});

describe("buildAssistantMessages", () => {
  it("keeps the system prompt first and the newest owner message last", () => {
    const messages = buildAssistantMessages({
      system: "system",
      history: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
      ],
      message: "how do I publish?",
    });
    expect(messages[0]).toEqual({ role: "system", content: "system" });
    expect(messages[messages.length - 1]).toEqual({
      role: "user",
      content: "how do I publish?",
    });
    expect(messages).toHaveLength(4);
  });

  it("rejects nothing but drops turns that sanitize to empty", () => {
    const messages = buildAssistantMessages({
      system: "system",
      history: [{ role: "assistant", content: "\u0000 \t " }],
      message: "hi",
    });
    expect(messages).toHaveLength(2);
  });

  it("replays at most six history turns", () => {
    const history = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `turn ${index}`,
    }));
    const messages = buildAssistantMessages({ system: "system", history, message: "last" });
    expect(messages).toHaveLength(1 + 6 + 1);
    expect(messages[1]).toEqual({ role: "user", content: "turn 6" });
  });
});
