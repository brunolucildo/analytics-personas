import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.main}>
      <img
        src="/brand/rondo-wordmark.svg"
        alt="Rondo"
        width={210}
        height={42}
        className={styles.logo}
      />
      <h1 className={styles.title}>Documentation</h1>
      <p className={styles.description}>
        The canonical Rondo documentation lives in <code>.docs/</code>, at the
        repository root.
      </p>
    </main>
  );
}
