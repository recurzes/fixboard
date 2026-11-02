export function ConfigError({ missing }: { missing: readonly string[] }) {
  return (
    <main className="mx-auto max-w-lg p-4">
      <h1 className="text-2xl font-bold">This site is not set up correctly</h1>
      <p className="mt-2">
        These settings are missing from the build. Add them and rebuild:
      </p>
      <ul className="mt-2 list-disc pl-6 font-mono break-all">
        {missing.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </main>
  );
}
