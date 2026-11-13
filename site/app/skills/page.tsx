import type { Metadata } from "next";
import { skills } from "@/lib/content";
import { SkillStore } from "./SkillStore";

export const metadata: Metadata = {
  title: "Skill store",
  description:
    "Browse Omnipolymath skills with a permission scan for each one: what it can run, what secrets it reads, and how risky it is.",
};

export default function Page() {
  return <SkillStore skills={skills()} />;
}
