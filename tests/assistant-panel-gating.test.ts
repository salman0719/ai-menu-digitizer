import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AssistantPanel } from "@/components/assistant/assistant-panel";

/**
 * The panel is the release surface for A3: with `assistantProposals` off it
 * must be a help-only chat, with no menu picker and no review affordance.
 * Static rendering is enough because this is a pure prop decision; the
 * interactive flow is covered by the assistant client and route tests.
 */

const menus = [{ id: "menu-1", title: "Lunch" }];

function render(proposalsEnabled: boolean, signedIn = true): string {
  return renderToStaticMarkup(
    createElement(AssistantPanel, {
      signedIn,
      proposalsEnabled,
      menus,
    })
  );
}

describe("AssistantPanel proposal gating", () => {
  it("hides the menu picker and shows the preview note when proposals are off", () => {
    const html = render(false);
    expect(html).not.toContain("Menu to edit");
    expect(html).not.toContain("Help only");
    expect(html).toContain("Menu changes are being tested with selected accounts");
    expect(html).toContain("Menu changes are not enabled for this account yet");
  });

  it("shows the menu picker when proposals are on", () => {
    const html = render(true);
    expect(html).toContain("Menu to edit");
    expect(html).toContain("Help only");
    expect(html).not.toContain("Menu changes are being tested with selected accounts");
  });

  it("keeps the sign-in card regardless of the proposal flag", () => {
    const html = render(true, false);
    expect(html).toContain("Sign in to use the assistant");
    expect(html).not.toContain("Menu to edit");
  });
});
