import AppHeader from '../../components/app-header/app-header'
import styles from './book.module.scss'

export default function BookPage() {
  return (
    <main className={styles.page}>
      <AppHeader title="Book" subtitle="MUSEUM COLLECTION" status="Book Page" />

      <section className={styles.workspace} aria-label="Book workspace">
        <aside className={styles.leftColumn} aria-label="Book left column" />
        <section className={styles.centerColumn} aria-label="Book center column" />
        <aside className={styles.rightColumn} aria-label="Book right column" />
      </section>
    </main>
  )
}
