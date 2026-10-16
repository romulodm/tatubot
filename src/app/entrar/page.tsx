import { Suspense } from "react";
import { Marca } from "@/components/Marca";
import { FormEntrar } from "./FormEntrar";
import s from "./entrar.module.css";

export default function Entrar() {
  return (
    <div className={s.pagina}>
      <header className={s.topo}>
        <Marca />
      </header>
      <main className={s.centro}>
        <Suspense>
          <FormEntrar />
        </Suspense>
      </main>
    </div>
  );
}
