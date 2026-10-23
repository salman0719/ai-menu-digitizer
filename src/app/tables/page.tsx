import { HomeScreen } from "@/components/home-screen";
import { parseAppRoute } from "@/features/navigation/routes";

/** The Tables tab (restaurant picker + printable table QR cards). */
export default function TablesPage() {
  return <HomeScreen initialRoute={parseAppRoute("/tables")} />;
}
