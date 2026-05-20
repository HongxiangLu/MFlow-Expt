import { CheckIcon, HamburgerMenuIcon } from '@radix-ui/react-icons'
import { DropdownMenu } from 'radix-ui'
import { Link, useLocation } from 'react-router-dom'
import styles from './app-header.module.scss'
import logo from './logo.svg'

type AppHeaderProps = {
  title?: string
  subtitle?: string
  status?: string
}

const menuItems = [
  { label: 'Dashboard', to: '/dashboard/ai-guide' },
  { label: 'Book', to: '/book' },
]

export default function AppHeader({
  title = '文通博物院',
  subtitle = 'WENTONG MUSEUM',
  status = 'AI 讲解员就绪',
}: AppHeaderProps) {
  const { pathname } = useLocation()

  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <div className={styles.brandSeal}>
          <img src={logo} width={40} alt="" />
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

      <DropdownMenu.Root>
        <DropdownMenu.Trigger className={styles.menuButton} type="button" aria-label="打开页面菜单">
          <HamburgerMenuIcon width={20} height={20} />
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content className={styles.menuContent} align="end" sideOffset={10}>
            {menuItems.map((item) => {
              const isActive = item.to.startsWith('/dashboard') ? pathname.startsWith('/dashboard') : pathname === item.to

              return (
                <DropdownMenu.Item className={styles.menuItem} asChild key={item.to}>
                  <Link to={item.to} aria-current={isActive ? 'page' : undefined}>
                    <span>{item.label}</span>
                    {isActive && <CheckIcon width={16} height={16} aria-hidden="true" />}
                  </Link>
                </DropdownMenu.Item>
              )
            })}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </header>
  )
}
