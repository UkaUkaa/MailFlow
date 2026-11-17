"use client";

import { createContext, useContext } from "react";
import type { User } from "./session";

export const SessionContext = createContext<User | null>(null);

/** The signed-in user. Only valid below `SessionGuard`. */
export function useCurrentUser(): User {
  const user = useContext(SessionContext);
  if (!user) throw new Error("useCurrentUser must be used inside SessionGuard");
  return user;
}
