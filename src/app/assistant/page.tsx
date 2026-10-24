import { HomeScreen } from "@/components/home-screen";
import { parseAppRoute } from "@/features/navigation/routes";

/** Assistant tab (A1) — signed-in help about the product. */
export default function AssistantPage() {
  return <HomeScreen initialRoute={parseAppRoute("/assistant")} />;
}
