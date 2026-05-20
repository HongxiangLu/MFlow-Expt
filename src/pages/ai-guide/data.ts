import type { ArtifactFact } from '../dashboard/types'

export const artifactFacts: ArtifactFact[] = [
  { label: '文物编号', value: 'HNM-2024-0156' },
  { label: '年代', value: '西周早期 (约公元前1046-前977)' },
  { label: '材质', value: '青铜 (铜锡合金)' },
  { label: '尺寸', value: '通高28.5cm, 口径22.4cm' },
  { label: '重量', value: '2.85 kg' },
  { label: '出土地点', value: '湖南省长沙市' },
  { label: '收藏单位', value: '湖南博物院' },
]

export const prompts = [
  '该文物是属于西周早期的吗？',
  '该文物的材质和铸造工艺有什么特点？',
  '可不可以根据其纹饰推测当时的社会信仰?',
  '铭文的内容主要记载了什么事件？',
]
