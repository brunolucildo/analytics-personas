import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Documentação</h1>
      <p className={styles.description}>
        A documentação canônica do Analytics Personas está em <code>.docs/</code>, na raiz do
        repositório.
      </p>
    </main>
  );
}
