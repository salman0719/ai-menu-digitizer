import { HomeScreen } from "@/components/home-screen";
import { parseAppRoute } from "@/features/navigation/routes";

/** My menus (the library). */
export default function MenusPage() {
  return <HomeScreen initialRoute={parseAppRoute("/menus")} />;
}
