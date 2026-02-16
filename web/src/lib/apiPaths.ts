const normalizePath = (path: string) => (path.startsWith("/") ? path : `/${path}`);

export const apiPath = (path: string) => `/api${normalizePath(path)}`;

export const contentPath = (path: string) => `/api/content${normalizePath(path)}`;
