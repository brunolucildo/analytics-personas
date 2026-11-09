import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Documentation</h1>
      <p className={styles.description}>
        The canonical Analytics Personas documentation lives in <code>.docs/</code>, at the
        repository root.
      </p>
    </main>
  );
}
