// Worker separado (WORKER_MODE=off no Next): mesmo código, outro processo.
// É o passo natural para separar em microsserviços depois.
import { iniciarComDesligamento } from "../src/lib/fila/iniciar";

iniciarComDesligamento();
