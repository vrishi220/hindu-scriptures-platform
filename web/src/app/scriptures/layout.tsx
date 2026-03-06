export default function ScripturesLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className="flex h-full min-h-0 flex-col overflow-hidden">{children}</div>;
}
