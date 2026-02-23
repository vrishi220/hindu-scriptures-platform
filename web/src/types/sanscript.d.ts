declare module "sanscript" {
  const Sanscript: {
    t(input: string, from: string, to: string, options?: Record<string, unknown>): string;
  };

  export default Sanscript;
}
