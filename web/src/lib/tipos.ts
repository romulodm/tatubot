// Documentos do Mongo que o web toca: só usuários e refresh tokens.
// O resto do modelo está descrito em api/src/tipos.js.
// Ids são strings UUID (crypto.randomUUID) em vez de ObjectId,
// para manter paridade com o modelo do context.md e facilitar logs e URLs.

export type Papel = "admin" | "usuario";

export interface Usuario {
  _id: string;
  nome: string;
  email: string;
  senhaHash: string;
  papel: Papel;
  criadoEm: Date;
  atualizadoEm: Date;
}

export interface RefreshToken {
  _id: string;
  usuarioId: string;
  familia: string; // cadeia de rotação; reuso revoga a família inteira
  tokenHash: string;
  expiraEm: Date;
  revogadoEm: Date | null;
  substituidoPor: string | null;
  criadoEm: Date;
}
