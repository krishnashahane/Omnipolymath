import type { Metadata } from "next";
import { Onboarding } from "./Onboarding";

export const metadata: Metadata = {
  title: "Onboarding",
  description:
    "Set up Omnipolymath in about two minutes. Pick what it should help with, how careful it should be, and a daily spend cap.",
};

export default function Page() {
  return <Onboarding />;
}
