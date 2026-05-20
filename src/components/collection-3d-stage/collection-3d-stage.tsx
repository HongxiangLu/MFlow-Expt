import { Suspense, useMemo } from 'react'
import { Clone, ContactShadows, Float, OrbitControls, useFBX, useGLTF } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Box3, Object3D, Vector3, type Object3DEventMap } from 'three'
import styles from './collection-3d-stage.module.scss'

type Collection3DStageProps = {
  modelUrl?: string
}

type SceneModelProps = {
  modelUrl?: string
}

type GltfArtifactModelProps = {
  modelUrl: string
}

type LoadedAssetModelProps = {
  object: Object3D<Object3DEventMap>
  fitHeight?: number
}

function GltfArtifactModel({ modelUrl }: GltfArtifactModelProps) {
  const { scene } = useGLTF(modelUrl)

  return <LoadedAssetModel object={scene} />
}

function FbxArtifactModel({ modelUrl }: GltfArtifactModelProps) {
  const object = useFBX(modelUrl)

  return <LoadedAssetModel object={object} fitHeight={2.5} />
}

function LoadedAssetModel({ object, fitHeight = 2.2 }: LoadedAssetModelProps) {
  const { center, maxSize, minY } = useMemo(() => {
    const box = new Box3().setFromObject(object)
    const size = new Vector3()
    const center = new Vector3()

    box.getSize(size)
    box.getCenter(center)

    object.traverse((node: Object3D<Object3DEventMap>) => {
      if ('castShadow' in node) {
        node.castShadow = true
      }

      if ('receiveShadow' in node) {
        node.receiveShadow = true
      }
    })

    return {
      center,
      maxSize: Math.max(size.x, size.y, size.z, 1),
      minY: box.min.y,
    }
  }, [object])

  const scale = fitHeight / maxSize

  return (
    <group position={[-center.x * scale, -minY * scale - 1.3, -center.z * scale]} scale={scale}>
      <Clone object={object} />
    </group>
  )
}

function SceneModel({ modelUrl }: SceneModelProps) {
  if (!modelUrl) {
    return null
  }

  if (modelUrl.toLowerCase().endsWith('.fbx')) {
    return <FbxArtifactModel modelUrl={modelUrl} />
  }

  return <GltfArtifactModel modelUrl={modelUrl} />
}

function SceneShell({ modelUrl }: SceneModelProps) {
  return (
    <>
      <color attach="background" args={['#090909']} />
      <fog attach="fog" args={['#090909', 7, 12]} />
      <ambientLight intensity={0.75} />
      <hemisphereLight args={['#f5dfb3', '#0a0d10', 1.15]} />
      <directionalLight castShadow position={[4.2, 5.8, 3.4]} intensity={2.4} shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <spotLight position={[-3.8, 4.5, 4.2]} intensity={1.25} angle={0.36} penumbra={1} />

      <Float speed={2.2} rotationIntensity={0.16} floatIntensity={0.32}>
        <group position={[0, -0.06, 0]}>
          <Suspense fallback={null}>
            <SceneModel modelUrl={modelUrl} />
          </Suspense>
        </group>
      </Float>

      <ContactShadows position={[0, -1.32, 0]} opacity={0.52} scale={4.6} blur={2.6} far={3.6} />

      <OrbitControls
        autoRotate
        autoRotateSpeed={0.9}
        enablePan={false}
        maxDistance={6.4}
        maxPolarAngle={Math.PI / 1.82}
        minDistance={3.4}
        minPolarAngle={Math.PI / 2.95}
      />
    </>
  )
}

export default function Collection3DStage(props: Collection3DStageProps) {
  return (
    <div className={styles.stageRoot}>
      <Canvas camera={{ fov: 30, position: [0, 1.4, 4.8] }} className={styles.canvas} dpr={[1, 1.8]} shadows>
        <SceneShell modelUrl={props.modelUrl} />
      </Canvas>
    </div>
  )
}
