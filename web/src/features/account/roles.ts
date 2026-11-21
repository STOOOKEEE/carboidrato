// Libellés des trois rôles de Bari, partagés par la navigation, l'inscription et la garde des espaces.

import type { AccountView, UserRole } from "../../../../src/api/contract";

interface RoleCopy {
  /** Nom du rôle dans le menu du compte. */
  name: string;
  /** Surtitre de l'espace. */
  space: string;
  /** « This space is for … ». */
  audience: string;
}

export const ROLE_COPY: Record<UserRole, RoleCopy> = {
  lender: { name: "Lender", space: "Lend", audience: "lenders" },
  business: { name: "Business", space: "Business", audience: "businesses" },
  public_body: { name: "Public body", space: "Public bodies", audience: "public bodies" },
};

/** Nom affiché d'un compte : personne, entreprise ou organisme. */
export function accountName(user: AccountView): string {
  switch (user.role) {
    case "lender":
      return user.profile.name;
    case "business":
      return user.profile.company;
    case "public_body":
      return user.profile.name;
  }
}
