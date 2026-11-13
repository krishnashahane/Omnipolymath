import type { Metadata } from "next";
import { Dashboard } from "./Dashboard";

export const metadata: Metadata = {
  title: "Dashboard",
  description:
    "Receipts, approvals, the tamper-evident action log and your daily spend, in one place. Demo workspace with sample data.",
};

export default function Page() {
  return <Dashboard />;
}
