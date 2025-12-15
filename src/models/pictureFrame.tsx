import { Text, useCursor, useTexture, useVideoTexture } from "@react-three/drei";
import { useFrame, useLoader, useThree, type ThreeElements, type ThreeEvent } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box3,
  DoubleSide,
  Euler,
  Group,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type PictureFrameProps = ThreeElements["group"] & {
  frameId: string;
  image: string; // Used for both image and video URL
  mediaType?: "image" | "video";
  caption?: string;
  imageScale?: number | [number, number];
  imageOffset?: [number, number, number];
  imageInset?: number;
  isActive: boolean;
  onToggle: (id: string) => void;
};

const DEFAULT_IMAGE_SCALE: [number, number] = [0.82, 0.82];
const HOVER_SCALE = 1.05;
const CAMERA_DISTANCE = 1.5;

function FrameContent({
  url,
  mediaType,
  imageWidth,
  imageHeight,
  imagePosition,
}: {
  url: string;
  mediaType: "image" | "video";
  imageWidth: number;
  imageHeight: number;
  imagePosition: [number, number, number];
}) {
  const { gl } = useThree();
  const texture = mediaType === "video" ? useVideoTexture(url) : useTexture(url);

  useEffect(() => {
    if (texture) {
      texture.colorSpace = SRGBColorSpace;
      // Video textures might not support anisotropy settings the same way or might need different handling
      if (mediaType === "image") {
        const maxAnisotropy =
          typeof gl.capabilities.getMaxAnisotropy === "function"
            ? gl.capabilities.getMaxAnisotropy()
            : 1;
        texture.anisotropy = maxAnisotropy;
      }
    }
  }, [texture, gl, mediaType]);

  const material = useMemo(
    () =>
      new MeshStandardMaterial({
        map: texture,
        roughness: 0.08,
        metalness: 0,
        side: DoubleSide,
        toneMapped: false, // Often better for video/images
      }),
    [texture]
  );

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  return (
    <mesh position={imagePosition} rotation={[0.435, Math.PI, 0]} material={material}>
      <planeGeometry args={[imageWidth, imageHeight]} />
    </mesh>
  );
}

export function PictureFrame({
  frameId,
  image,
  mediaType = "image",
  caption,
  imageScale = DEFAULT_IMAGE_SCALE,
  imageOffset,
  imageInset = 0.01,
  isActive,
  onToggle,
  children,
  ...groupProps
}: PictureFrameProps) {
  const { camera } = useThree();
  const groupRef = useRef<Group>(null);
  const gltf = useLoader(GLTFLoader, import.meta.env.BASE_URL + "picture_frame.glb");
  const [isHovered, setIsHovered] = useState(false);

  useCursor(isHovered, "pointer");

  const frameScene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);

  const { frameSize, frameCenter } = useMemo(() => {
    const box = new Box3().setFromObject(frameScene);
    const size = new Vector3();
    const center = new Vector3();
    box.getSize(size);
    box.getCenter(center);
    return { frameSize: size, frameCenter: center };
  }, [frameScene]);

  const scaledImage = useMemo<[number, number]>(() => {
    if (Array.isArray(imageScale)) {
      return imageScale;
    }
    return [imageScale, imageScale];
  }, [imageScale]);

  const [imageScaleX, imageScaleY] = scaledImage;

  const imageWidth = frameSize.x * imageScaleX;
  const imageHeight = frameSize.y * imageScaleY;

  const [offsetX, offsetY, offsetZ] = imageOffset ?? [
    0,
    0.05,
    -0.27,
  ];

  const imagePosition: [number, number, number] = [
    frameCenter.x + offsetX,
    frameCenter.y + offsetY,
    frameCenter.z + offsetZ,
  ];

  // Animation Logic
  const defaultPosition = useMemo(() => new Vector3(...(groupProps.position as [number, number, number] || [0, 0, 0])), [groupProps.position]);
  // Handle rotation array or Euler
  const defaultQuaternion = useMemo(() => {
    const rot = groupProps.rotation as [number, number, number];
    const euler = new Euler(...(rot || [0, 0, 0]));
    return new Quaternion().setFromEuler(euler);
  }, [groupProps.rotation]);

  // Initialize position/rotation
  useEffect(() => {
    if (!groupRef.current) return;
    // We only force reset if not active, to prevent jumping if props change slightly? 
    // Actually we should respect props changes.
    if (!isActive) {
      groupRef.current.position.copy(defaultPosition);
      groupRef.current.quaternion.copy(defaultQuaternion);
    }
  }, [defaultPosition, defaultQuaternion, isActive]);


  const tmpPosition = useMemo(() => new Vector3(), []);
  const tmpQuaternion = useMemo(() => new Quaternion(), []);
  const tmpDirection = useMemo(() => new Vector3(), []);
  const cameraOffset = useMemo(() => new Vector3(0, 0, 0), []);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const positionTarget = tmpPosition;
    const rotationTarget = tmpQuaternion;
    const scaleTarget = new Vector3(1, 1, 1);

    if (isActive) {
      // Move in front of camera
      positionTarget.copy(camera.position);
      positionTarget.add(
        tmpDirection
          .copy(camera.getWorldDirection(tmpDirection))
          .multiplyScalar(CAMERA_DISTANCE)
      );
      positionTarget.add(cameraOffset);
      // Face camera
      rotationTarget.copy(camera.quaternion);

      // Rotate 180 degrees around Y axis to correct orientation when facing camera
      const flipQuaternion = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
      rotationTarget.multiply(flipQuaternion);

      // Adjust rotation to face forward if the model is rotated locally
      // The frame model might be oriented differently. The original code had specific rotations.
      // We might need to adjust based on visual testing, but let's assume standard face-camera

      // The frame scene seems to be rotated in the original code: <group rotation={[0.04, 0, 0]}> inside the component
      // So ensuring the group faces the camera should be enough.

    } else {
      positionTarget.copy(defaultPosition);
      rotationTarget.copy(defaultQuaternion);
      if (isHovered) {
        const hoverScale = (groupProps.scale as number || 1) * HOVER_SCALE;
        scaleTarget.setScalar(hoverScale);
      } else {
        const baseScale = (groupProps.scale as number || 1);
        scaleTarget.setScalar(baseScale);
      }
    }

    const lerpSpeed = isActive ? 4 : 8;
    group.position.lerp(positionTarget, 1 - Math.exp(-delta * lerpSpeed));
    group.quaternion.slerp(rotationTarget, 1 - Math.exp(-delta * lerpSpeed));
    // Simple scale lerp (ignoring axis differences in scale prop for now, assuming uniform scale number)
    // group.scale.lerp(scaleTarget, 1 - Math.exp(-delta * lerpSpeed));
  });

  const handlePointerOver = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (!isActive) setIsHovered(true);
  }, [isActive]);

  const handlePointerOut = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setIsHovered(false);
  }, []);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onToggle(frameId);
  }, [frameId, onToggle]);


  return (
    <group ref={groupRef} {...groupProps} onClick={handleClick} onPointerOver={handlePointerOver} onPointerOut={handlePointerOut}>
      <group rotation={[0.04, 0, 0]}>
        <primitive object={frameScene} />
        <FrameContent
          url={image}
          mediaType={mediaType}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          imagePosition={imagePosition}
        />
        {/* Caption Overlay */}
        <group position={imagePosition} rotation={[0.435, Math.PI, 0]}>
          <group position={[0, -imageHeight / 2 + 0.125, 0.01]}>
            {/* Background for text */}
            <mesh position={[0, 0, -0.001]}>
              <planeGeometry args={[imageWidth * 0.9, 0.15]} />
              <meshBasicMaterial color="black" transparent opacity={0.6} />
            </mesh>
            <Text
              fontSize={0.06}
              color="white"
              anchorX="center"
              anchorY="middle"
              maxWidth={imageWidth * 0.85}
              textAlign="center"
              fontWeight="bold"
            >
              {isActive ? caption : "Click to reveal"}
            </Text>
          </group>
        </group>
        {children}
      </group>
    </group>
  );
}
