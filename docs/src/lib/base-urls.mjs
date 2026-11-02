import { withBasePath } from "./base-path.mjs";

/** Apply the site base to links and images authored in Markdown. */
export default function baseUrls(base) {
  return {
    name: "base-urls",
    element: {
      filter: ["a", "img"],
      visit(node, context) {
        for (const property of ["href", "src"]) {
          const value = node.properties[property];
          if (typeof value === "string") context.setProperty(node, property, withBasePath(value, base));
        }
      },
    },
  };
}
