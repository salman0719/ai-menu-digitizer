import { HomeScreen } from "@/components/home-screen";
import { parseAppRoute } from "@/features/navigation/routes";

/** The capture screen (the app's home). Other screens live at their own URLs. */
export default function Home() {
  return <HomeScreen initialRoute={parseAppRoute("/")} />;
}
