import { HomeScreen } from "@/components/home-screen";
import { parseAppRoute } from "@/features/navigation/routes";

/** The orders board. */
export default function OrdersPage() {
  return <HomeScreen initialRoute={parseAppRoute("/orders")} />;
}
