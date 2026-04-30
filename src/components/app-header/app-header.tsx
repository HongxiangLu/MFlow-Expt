import logoUrl from './logo.svg'
import styles from './app-header.module.scss'

type AppHeaderProps = {
  title?: string
  subtitle?: string
}

export default function AppHeader({
  title = '文博知识图谱 AI 助手',
  subtitle = 'Cultural and Creative Knowledge Graph AI Assistant',
}: AppHeaderProps) {
  return (
    <section className={styles.topNav} aria-label="文博 AI 工作台导航">
      <div className={styles.brand}>
        <div className={styles.seal}>
          <img src={logoUrl} alt="文博知识图谱 AI 助手" />
        </div>
        <div className={styles.brandCopy}>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </div>
        <div className={styles.searchInput}>
          <span className={styles.searchIcon}>⌕</span>
          <span>搜索文物名称 / 纹饰 / 年代</span>
        </div>
    </section>
  )
}
