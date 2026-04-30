import { useRef, useState } from 'react'
import AppHeader from '../../components/app-header/app-header'
import KnowledgeGraph from '../../components/knowledge-graph/knowledge-graph'
import artifactMockUrl from '../../../mock/mock.jpg'
import relatedArtifact1Url from './related-assets/mock1-thumb.jpg'
import relatedArtifact2Url from './related-assets/mock2-thumb.jpg'
import relatedArtifact3Url from './related-assets/mock3-thumb.jpg'
import relatedArtifact4Url from './related-assets/mock4-thumb.jpg'
import relatedArtifact5Url from './related-assets/mock5-thumb.jpg'
import relatedArtifact6Url from './related-assets/mock6-thumb.jpg'
import relatedArtifact7Url from './related-assets/mock7-thumb.jpg'
import relatedArtifact8Url from './related-assets/mock8-thumb.jpg'
import relatedArtifact9Url from './related-assets/mock9-thumb.jpg'
import styles from './dashboarad.module.scss'

const artifactFacts = [
  { label: '时代', value: '宋' },
  { label: '类别', value: '雕版' },
  { label: '材质', value: '纸' },
  { label: '外观形式', value: '线装' },
  { label: '工艺', value: '雕版印刷' },
  { label: '主题', value: '诗文' },
]
const relatedArtifacts = [
  relatedArtifact1Url,
  relatedArtifact2Url,
  relatedArtifact3Url,
  relatedArtifact4Url,
  relatedArtifact5Url,
  relatedArtifact6Url,
  relatedArtifact7Url,
  relatedArtifact8Url,
  relatedArtifact9Url,
]
const prompts = [
  '帮我查找商代青铜礼器中的兽面纹',
  '我想了解殷墟出土文物和祭祀制度',
  '生成一段适合展厅观众阅读的文物说明',
]
const recentTopics = ['青铜器', '陶俑', '丝路文物']
function classNames(...names: Array<string | false | undefined>) {
  return names.filter(Boolean).join(' ')
}

function Chip({
  children,
  onClick,
}: {
  children: string
  onClick?: () => void
}) {
  if (onClick) {
    return (
      <button className={styles.chip} type="button" onClick={onClick}>
        {children}
      </button>
    )
  }

  return (
    <span className={styles.chip}>
      {children}
    </span>
  )
}
export default function MuseumAiPage() {
  const [query, setQuery] = useState('')
  const relatedListRef = useRef<HTMLDivElement>(null)

  function scrollRelatedArtifacts(direction: -1 | 1) {
    const list = relatedListRef.current
    if (!list) {
      return
    }

    const firstItem = list.querySelector('button')
    const listStyle = window.getComputedStyle(list)
    const gap = Number.parseFloat(listStyle.columnGap || listStyle.gap) || 0
    const itemWidth = firstItem?.getBoundingClientRect().width ?? 0

    list.scrollBy({
      left: direction * (itemWidth + gap) * 2,
      behavior: 'smooth',
    })
  }

  return (
    <main className={styles.page}>
      <AppHeader />
      <section className={styles.workspace} aria-label="文博 AI 智能问答工作台">
        <aside className={classNames(styles.panel, styles.leftPanel)}>
          <h2>文物信息</h2>
          <div className={styles.artifactPlaceholder}>
            <div className={styles.artifactImageFrame}>
              <img src={artifactMockUrl} alt="杜工部草堂诗笺" decoding="async" />
            </div>
            <div className={styles.artifactInfo}>
              <div className={styles.artifactTitleBlock}>
                <h3>杜工部草堂诗笺</h3>
                <p>宋代重要杜诗注本 · 孤本</p>
              </div>

              <dl className={styles.artifactFacts}>
                {artifactFacts.map((fact) => (
                  <div className={styles.artifactFact} key={fact.label}>
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>

              <section className={styles.artifactIntro}>
                <p>
                  《杜工部草堂诗笺》五十卷，以编年集注的形式笺注杜甫诗歌，是宋代最重要的杜诗注本之一。此本无《诗笺》正文，所存五卷为宋祁撰《传叙碑铭》一卷、赵子栎与鲁訔撰《年谱》二卷、蔡梦弼辑《诗话》二卷，系孤本。季振宜等旧藏。
                </p>
              </section>

              <section className={styles.relatedArtifacts} aria-label="相关文物">
                <div className={styles.relatedArtifactHeader}>
                  <h3>相关文物</h3>
                  <div className={styles.relatedArtifactControls}>
                    <button
                      type="button"
                      aria-label="向左查看更多相关文物"
                      onClick={() => scrollRelatedArtifacts(-1)}
                    >
                      &lt;
                    </button>
                    <button
                      type="button"
                      aria-label="向右查看更多相关文物"
                      onClick={() => scrollRelatedArtifacts(1)}
                    >
                      &gt;
                    </button>
                  </div>
                </div>
                <div className={styles.relatedArtifactList} ref={relatedListRef}>
                  {relatedArtifacts.map((artifactUrl, index) => (
                    <button className={styles.relatedArtifactCard} type="button" key={artifactUrl}>
                      <img
                        src={artifactUrl}
                        alt={`相关文物 ${index + 1}`}
                        decoding="async"
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
              </section>
            </div>
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
            </div>
          </header>

          <div className={styles.graphCanvas} aria-label="文物关系图谱">
            <KnowledgeGraph />
          </div>
        </aside>
      </section>
    </main>
  )
}
