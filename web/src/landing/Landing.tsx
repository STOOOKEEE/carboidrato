import { Doors } from "./Doors";
import { Hero } from "./Hero";
import { Outro } from "./Outro";

export function Landing() {
  return (
    <main>
      <Hero />
      <Doors />
      <Outro />
    </main>
  );
}
