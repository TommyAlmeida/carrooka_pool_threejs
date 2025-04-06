import {
  Canvas,
  useFrame,
  useLoader,
  ThreeEvent,
  useThree,
} from "@react-three/fiber";
import { OrbitControls, Line } from "@react-three/drei";
import {
  useRef,
  useState,
  useEffect,
  createContext,
  useContext,
  useMemo,
  useCallback,
} from "react";
import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import "./globals.css";

// Create a context for the orbit controls reference
type ControlsContextType = {
  controlsRef: React.RefObject<any> | null;
  setControlsRef: (ref: React.RefObject<any>) => void;
};

const ControlsContext = createContext<ControlsContextType>({
  controlsRef: null,
  setControlsRef: () => {},
});

interface ModelProps {
  objPath: string;
  mtlPath: string;
  position?: [number, number, number];
  scale?: [number, number, number];
}

function Model({
  objPath,
  mtlPath,
  position = [0, 0, 0],
  scale = [1, 1, 1],
}: ModelProps) {
  const group = useRef<THREE.Group>(null);
  const materials = useLoader(MTLLoader, mtlPath);
  const obj = useLoader(OBJLoader, objPath, (loader) => {
    materials.preload();
    loader.setMaterials(materials);
  });

  return (
    <primitive ref={group} object={obj} position={position} scale={scale} />
  );
}

function Board() {
  return (
    <Model
      objPath="/models/carrooka_pool8.obj"
      mtlPath="/models/carrooka_pool8.mtl"
      position={[0, 0, 0]}
      scale={[0.1, 0.1, 0.1]}
    />
  );
}

interface DraggablePuckProps {
  position: [number, number, number];
  color?: string;
  radius?: number;
  height?: number;
  onCollision?: (otherPuck: THREE.Object3D) => void;
}

function DraggablePuck({
  position,
  color = "gray",
  radius = 0.3,
  height = 0.1,
  onCollision,
}: DraggablePuckProps) {
  const ref = useRef<THREE.Mesh>(null);
  const [dragging, setDragging] = useState(false);
  const [initialPos, setInitialPos] = useState<THREE.Vector3 | null>(null);
  const [dragPos, setDragPos] = useState<THREE.Vector3 | null>(null);
  const velocity = useRef(new THREE.Vector3(0, 0, 0));
  const [showLine, setShowLine] = useState(false);
  const [forceMagnitude, setForceMagnitude] = useState(0);
  const [linePoints, setLinePoints] = useState<[THREE.Vector3, THREE.Vector3]>([
    new THREE.Vector3(),
    new THREE.Vector3(),
  ]);
  const activePointerId = useRef<number | null>(null);
  const isMoving = useRef(false);

  // Get access to the controls ref
  const { controlsRef } = useContext(ControlsContext);
  const { gl, camera, raycaster } = useThree();

  // Set initial position
  useEffect(() => {
    if (ref.current) {
      ref.current.position.set(position[0], position[1], position[2]);
    }
  }, [position]);

  // Check if the puck is currently moving
  const checkIfMoving = useCallback(() => {
    return velocity.current.lengthSq() > 0.001;
  }, []);

  // Convert screen coords to 3D point on the dragging plane
  const getPointOnDraggingPlane = useCallback(
    (x: number, y: number): THREE.Vector3 => {
      // Create a plane that's perpendicular to the camera
      const planeNormal = new THREE.Vector3(0, 1, 0); // Y-up
      const puckPosition = ref.current
        ? ref.current.position.clone()
        : new THREE.Vector3(...position);
      const plane = new THREE.Plane(planeNormal, -puckPosition.y); // Place at puck height

      // Screen coordinates to normalized device coordinates
      const normalizedX = (x / window.innerWidth) * 2 - 1;
      const normalizedY = -(y / window.innerHeight) * 2 + 1;

      // Update raycaster with normalized coordinates
      raycaster.setFromCamera(
        new THREE.Vector2(normalizedX, normalizedY),
        camera
      );

      // Find intersection with the plane
      const intersection = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, intersection);

      return intersection;
    },
    [camera, position, raycaster]
  );

  // Handle pointer move globally
  const handleGlobalPointerMove = useCallback(
    (e: PointerEvent) => {
      if (dragging && activePointerId.current === e.pointerId && initialPos) {
        // Get point on the dragging plane
        const point = getPointOnDraggingPlane(e.clientX, e.clientY);
        setDragPos(point);

        // Calculate direction from initial position to current drag position
        const direction = new THREE.Vector3().subVectors(initialPos, point);

        // Limit the drag distance for reasonable force
        const maxDragDistance = 2;
        const dragDistance = Math.min(direction.length(), maxDragDistance);
        const normalizedDirection = direction.clone().normalize();

        // Calculate force magnitude (0 to 1)
        const force = dragDistance / maxDragDistance;
        setForceMagnitude(force);

        // Update line points for visualization
        if (ref.current) {
          const start = new THREE.Vector3().copy(ref.current.position);
          const end = start
            .clone()
            .add(normalizedDirection.multiplyScalar(dragDistance));
          setLinePoints([start, end]);
        }
      }
    },
    [dragging, initialPos, getPointOnDraggingPlane]
  );

  // Handle pointer up globally
  const handleGlobalPointerUp = useCallback(
    (e: PointerEvent) => {
      if (dragging && activePointerId.current === e.pointerId) {
        // Re-enable orbit controls when done dragging
        if (controlsRef?.current) {
          controlsRef.current.enabled = true;
        }

        if (initialPos && dragPos) {
          // Calculate direction and apply force
          const direction = new THREE.Vector3().subVectors(initialPos, dragPos);

          // Only apply force if there's a significant direction
          if (direction.lengthSq() > 0.001) {
            // Normalize and scale by force magnitude
            const speed = Math.min(forceMagnitude * 0.4, 0.4); // Cap the maximum speed
            velocity.current.copy(direction.normalize().multiplyScalar(speed));
            isMoving.current = true;
          }
        }

        // Clean up
        setDragging(false);
        setInitialPos(null);
        setDragPos(null);
        setShowLine(false);
        activePointerId.current = null;

        // Remove global listeners
        window.removeEventListener("pointermove", handleGlobalPointerMove);
        window.removeEventListener("pointerup", handleGlobalPointerUp);
      }
    },
    [
      dragging,
      initialPos,
      dragPos,
      forceMagnitude,
      controlsRef,
      handleGlobalPointerMove,
    ]
  );

  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();

      // Only allow dragging when not in motion
      if (!checkIfMoving()) {
        // Disable orbit controls while dragging
        if (controlsRef?.current) {
          controlsRef.current.enabled = false;
        }

        // Store the pointer ID for tracking
        activePointerId.current = e.pointerId;

        // Convert event point to Vector3
        const point = new THREE.Vector3().copy(e.point);

        setDragging(true);
        setInitialPos(point);
        setShowLine(true);

        // Add global event listeners to track pointer movement outside the puck
        window.addEventListener("pointermove", handleGlobalPointerMove);
        window.addEventListener("pointerup", handleGlobalPointerUp);
      }
    },
    [checkIfMoving, controlsRef, handleGlobalPointerMove, handleGlobalPointerUp]
  );

  // Clean up event listeners when component unmounts
  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", handleGlobalPointerMove);
      window.removeEventListener("pointerup", handleGlobalPointerUp);
    };
  }, [handleGlobalPointerMove, handleGlobalPointerUp]);

  useFrame(() => {
    if (ref.current) {
      // Check and update movement state
      isMoving.current = velocity.current.lengthSq() > 0.001;

      // Apply velocity
      if (isMoving.current) {
        ref.current.position.add(velocity.current);
        velocity.current.multiplyScalar(0.98); // Apply friction

        // Simple boundary collision (assuming board is roughly -5 to 5 in x and z)
        const bounds = 5;
        const pos = ref.current.position;

        if (Math.abs(pos.x) > bounds) {
          pos.x = Math.sign(pos.x) * bounds;
          velocity.current.x *= -0.8; // Bounce with energy loss
        }

        if (Math.abs(pos.z) > bounds) {
          pos.z = Math.sign(pos.z) * bounds;
          velocity.current.z *= -0.8; // Bounce with energy loss
        }

        // Check for collisions with other pucks (would need to be implemented)
        // This could be done by passing all pucks to each puck and checking distances
      }
    }
  });

  return (
    <>
      <mesh
        ref={ref}
        position={position}
        castShadow
        receiveShadow
        onPointerDown={handlePointerDown}
      >
        <cylinderGeometry args={[radius, radius, height, 32]} />
        <meshStandardMaterial color={color} />
      </mesh>

      {/* Force direction indicator line */}
      {showLine && (
        <>
          <Line points={linePoints} color="white" lineWidth={1} />
          <mesh position={linePoints[1]} scale={[0.1, 0.1, 0.1]}>
            <sphereGeometry />
            <meshBasicMaterial
              color={
                forceMagnitude > 0.7
                  ? "red"
                  : forceMagnitude > 0.3
                  ? "yellow"
                  : "green"
              }
            />
          </mesh>
        </>
      )}
    </>
  );
}

function Striker() {
  return <DraggablePuck position={[0, 0.1, -3]} color="white" radius={0.35} />;
}

interface PuckModelProps {
  index: number;
  position?: [number, number, number];
}

function PuckModel({ index, position = [0, 0.1, 0] }: PuckModelProps) {
  // Using colors instead of models for simplicity and better physics
  const colors = ["red", "blue", "green", "yellow", "purple", "orange"];
  return (
    <DraggablePuck
      position={position}
      color={colors[(index - 1) % colors.length]}
    />
  );
}

// Custom OrbitControls with ref
function Controls() {
  const controlsRef = useRef(null);
  const { setControlsRef } = useContext(ControlsContext);

  useEffect(() => {
    setControlsRef(controlsRef);
  }, [setControlsRef]);

  return <OrbitControls ref={controlsRef} />;
}

export default function App() {
  const [controlsRef, setControlsRef] = useState<React.RefObject<any> | null>(
    null
  );

  return (
    <ControlsContext.Provider value={{ controlsRef, setControlsRef }}>
      <div className="w-screen h-screen">
        <Canvas
          shadows
          camera={{ position: [0, 8, 8], fov: 50 }}
          onPointerMissed={() => {}}
        >
          <ambientLight intensity={0.4} />
          <directionalLight
            position={[5, 10, 5]}
            intensity={1}
            castShadow
            shadow-mapSize-width={1024}
            shadow-mapSize-height={1024}
          />
          <Controls />

          <Board />
          <Striker />

          {/* Puck models with better distribution */}
          <PuckModel index={1} position={[-2, 0.1, 0]} />
          <PuckModel index={2} position={[2, 0.1, 0]} />
          <PuckModel index={3} position={[0, 0.1, 2]} />
          <PuckModel index={4} position={[-1, 0.1, 1]} />
          <PuckModel index={5} position={[1, 0.1, 1]} />
        </Canvas>
      </div>
    </ControlsContext.Provider>
  );
}
