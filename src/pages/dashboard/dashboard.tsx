import { useState } from 'react'
import AppHeader from '../../components/app-header/app-header'
import KnowledgeGraph from '../../components/knowledge-graph/knowledge-graph'
import artifactMockUrl from '../../../mock/mock.jpg'
import styles from './dashboarad.module.scss'

const entries = [
  { title: '青铜器纹饰', tone: 'green' },
  { title: '商代礼制', tone: 'red' },
  { title: '殷墟考古', tone: 'blue' },
  { title: '展签文案生成', tone: 'gold' },
]
const prompts = [
  '帮我查找商代青铜礼器中的兽面纹',
  '我想了解殷墟出土文物和祭祀制度',
  '生成一段适合展厅观众阅读的文物说明',
]
const recentTopics = ['青铜器', '陶俑', '丝路文物']
const checklist = [
  { text: '实体识别：8 个模拟实体', tone: 'green' },
  { text: '关系抽取：9 条模拟关系', tone: 'gold' },
  { text: '证据溯源：示例权重已生成', tone: 'gold' },
]

function classNames(...names: Array<string | false | undefined>) {
  return names.filter(Boolean).join(' ')
}

function Chip({
  children,
  active = false,
  warning = false,
  className,
  onClick,
}: {
  children: string
  active?: boolean
  warning?: boolean
  className?: string
  onClick?: () => void
}) {
  const chipClassName = classNames(
    styles.chip,
    active && styles.chipActive,
    warning && styles.chipWarning,
    className,
  )

  if (onClick) {
    return (
      <button className={chipClassName} type="button" onClick={onClick}>
        {children}
      </button>
    )
  }

  return (
    <span className={chipClassName}>
      {children}
    </span>
  )
}

function Dot({ tone }: { tone: string }) {
  return <span className={classNames(styles.dot, styles[`dot${tone}`])} aria-hidden="true" />
}

export default function MuseumAiPage() {
  const [query, setQuery] = useState('')

  return (
    <main className={styles.page}>
      <AppHeader />
      <section className={styles.workspace} aria-label="文博 AI 智能问答工作台">
        <aside className={classNames(styles.panel, styles.leftPanel)}>
          <h2>文物信息</h2>
          <div className={styles.artifactPlaceholder}>
            <img src={artifactMockUrl} alt="研究对象文物" />
          </div>

          <h3>热门研究入口</h3>
          <div className={styles.entryList}>
            {entries.map((entry) => (
              <button className={styles.entryRow} type="button" key={entry.title}>
                <Dot tone={entry.tone} />
                <span>
                  <strong>{entry.title}</strong>
                  <small>点击填入搜索关键词</small>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className={classNames(styles.panel, styles.chatPanel)} aria-label="文博 AI 对话">
          <header className={styles.panelHeader}>
            <div>
              <h2>与历史对话</h2>
            </div>
          </header>

          <div className={styles.welcomeState}>
            <div className={styles.aiMark}>AI</div>
            <h2>想研究哪件文物？</h2>
            <p>
              输入文物名称、年代、纹饰，或直接提出研究问题。搜索后会自动生成文物详情、AI 回答和右侧关系图谱。
            </p>
            <div className={styles.promptList}>
              {prompts.map((prompt) => (
                <button type="button" key={prompt}>
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.recentTopics} aria-label="最近话题">
            {recentTopics.map((topic) => (
              <Chip key={topic} onClick={() => setQuery(topic)}>
                {topic}
              </Chip>
            ))}
          </div>

          <form className={styles.composer} onSubmit={(event) => event.preventDefault()}>
            <input
              className={styles.composerInput}
              type="text"
              aria-label="搜索文物或输入你的第一个问题"
              placeholder="搜索文物或输入你的第一个问题..."
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </form>
        </section>

        <aside className={classNames(styles.panel, styles.graphPanel)}>
          <header className={styles.panelHeader}>
            <div>
              <h2>Graph 关系图谱</h2>
              <p>搜索或提问后自动生成</p>
            </div>
          </header>

          <div className={styles.graphCanvas} aria-label="文物关系图谱">
            <KnowledgeGraph />
          </div>

          <div className={styles.graphNote}>
            <h3>司母戊鼎关系图谱</h3>
            <div className={styles.checklist}>
              {checklist.map((item) => (
                <div className={styles.checkRow} key={item.text}>
                  <Dot tone={item.tone} />
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </main>
  )
}
