import { HomeScreen } from "@/components/home-screen";
import { parseAppRoute } from "@/features/navigation/routes";

/** Restaurant settings (name, link, team). */
export default function SettingsPage() {
  return <HomeScreen initialRoute={parseAppRoute("/settings")} />;
}
