import type { Metadata } from "next";
import MapEditor from "./map-editor";

export const metadata: Metadata = {
  title: "Blockout — конструктор игровых локаций",
  description: "Локальный редактор схем и блокинга игровых уровней.",
};

export default function Home() {
  return <MapEditor />;
}
