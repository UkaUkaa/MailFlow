"use client";

import { useEffect } from "react";
import { describeUserTime, rememberTimeZone } from "@/shared/lib/user-time";

/**
 * On load: tells the server where the user is (the `mf_tz` cookie, from the device's time
 * zone) and prints the user's time to the browser console.
 */
export function UserTimeSync() {
  useEffect(() => {
    rememberTimeZone();
    console.info(describeUserTime());
  }, []);
  return null;
}
