/**
 * Shared prop shapes.
 *
 * These live in their own module so client components never import from a
 * server component's file just to get a type — that creates a cycle across the
 * server/client boundary, which Turbopack resolves by dragging the server
 * module into the client graph.
 */
export interface WorkspaceOption {
  id: string;
  name: string;
  slug: string;
  organizationName: string;
}
