import { Menu } from 'lucide-react'
import styles from './app-header.module.scss'
import logo from './logo.svg'

type AppHeaderProps = {
  title?: string
  subtitle?: string
  status?: string
}

export default function AppHeader({
  title = '文通博物院',
  subtitle = 'WENTONG MUSEUM',
  status = 'AI 讲解员就绪',
}: AppHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <div className={styles.brandSeal}>
          <img src={logo} width={40} />
        </div>
        <div className={styles.brandCopy}>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </div>

      <div className={styles.headerStatus}>
        <span aria-hidden="true" />
        <p>{status}</p>
      </div>
      <button className={styles.menuButton} type="button" aria-label="打开菜单">
        <Menu size={20} />
      </button>
    </header>
  )
}
