import { useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import Slider from '@react-native-community/slider';
import { useRouter } from 'expo-router';
import { supabase } from '../../../src/lib/supabase';
import { ThreadPreview } from '../../../src/components/ThreadPreview';
import { FrameShape, ThreadMode } from '../../../src/store/projectStore';
import {
  prepareImage,
  toGrayscale,
  analyzeEdgeDensity,
  recommendCounts,
  computePerimeter,
  WORKING_SIZE,
} from '../../../src/algorithm/imageProcessing';
import { computeNailPositions, computeStringArt } from '../../../src/algorithm/stringArt';
import { PRESET_PALETTES, ThreadColor } from '../../../src/algorithm/colorDecompose';
import { buildColorLayers } from '../../../src/algorithm/colorDecompose';
import { useTheme, ThemeColors } from '../../../src/theme';

type WizardStep = 'frame' | 'image' | 'settings' | 'generate' | 'preview';
const STEP_ORDER: WizardStep[] = ['frame', 'image', 'settings', 'generate', 'preview'];

// Minimum nail spacing in mm before we warn the user
const MIN_SPACING_MM = 5;

function getNailSpacingMm(shape: FrameShape, widthCm: number, heightCm: number, nailCount: number): number {
  const perimeterMm = shape === 'circle'
    ? Math.PI * widthCm * 10
    : 2 * (widthCm + heightCm) * 10;
  return perimeterMm / nailCount;
}

function maxNailsForFrame(shape: FrameShape, widthCm: number, heightCm: number): number {
  const perimeterMm = shape === 'circle'
    ? Math.PI * widthCm * 10
    : 2 * (widthCm + heightCm) * 10;
  return Math.floor(perimeterMm / MIN_SPACING_MM);
}

export default function NewProjectScreen() {
  const router = useRouter();
  const colors = useTheme();

  // Wizard state
  const [step, setStep] = useState<WizardStep>('frame');

  // Frame setup
  const [frameShape, setFrameShape] = useState<FrameShape>('circle');
  const [frameDiameter, setFrameDiameter] = useState('30');
  const [frameWidth, setFrameWidth] = useState('30');
  const [frameHeight, setFrameHeight] = useState('30');

  // Image
  const [imageUri, setImageUri] = useState<string | null>(null);

  // Settings
  const [mode, setMode] = useState<ThreadMode>('bw');
  const [nailCount, setNailCount] = useState(200);
  const [stringCount, setStringCount] = useState(3000);
  const [recommendedNails, setRecommendedNails] = useState(200);
  const [recommendedStrings, setRecommendedStrings] = useState(3000);
  const [title, setTitle] = useState('');
  const [selectedPalette, setSelectedPalette] = useState<ThreadColor[]>(PRESET_PALETTES.cmy);

  // Generation
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [nailSequence, setNailSequence] = useState<number[] | null>(null);
  const [colorLayers, setColorLayers] = useState<{ color: string; nailSequence: number[] }[] | null>(null);
  const [nailPositions, setNailPositions] = useState<import('../../../src/algorithm/stringArt').NailPosition[]>([]);

  // Saving
  const [saving, setSaving] = useState(false);

  const pixelsRef = useRef<Uint8ClampedArray | null>(null);

  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Compute current frame dimensions in cm
  const widthCm = frameShape === 'circle' ? parseFloat(frameDiameter) || 30 : parseFloat(frameWidth) || 30;
  const heightCm = frameShape === 'circle' ? parseFloat(frameDiameter) || 30 : parseFloat(frameHeight) || 30;

  function handleBack() {
    const idx = STEP_ORDER.indexOf(step);
    if (idx <= 0) {
      router.replace('/(app)');
    } else {
      // Skip generate step when going back (it's a transient state)
      const prevStep = STEP_ORDER[idx - 1];
      setStep(prevStep === 'generate' ? 'settings' : prevStep);
    }
  }

  async function handlePickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  }

  async function handleCameraImage() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission required', 'Camera permission is needed to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  }

  async function handleProceedToSettings() {
    if (!imageUri) {
      Alert.alert('No image', 'Please pick or take a photo first.');
      return;
    }

    try {
      const perimeter = computePerimeter(frameShape, widthCm, heightCm);
      const { pixels, size } = await prepareImage(imageUri, frameShape);
      pixelsRef.current = pixels;
      const gray = toGrayscale(pixels, size);
      const edgeDensity = analyzeEdgeDensity(gray, size);
      const { nails, strings } = recommendCounts(perimeter, edgeDensity);

      setRecommendedNails(nails);
      setRecommendedStrings(strings);
      setNailCount(nails);
      setStringCount(strings);
    } catch (e) {
      // Fallback to defaults if processing fails
    }

    setStep('settings');
  }

  async function handleGenerate() {
    if (!imageUri) return;
    setGenerating(true);
    setProgress(0);
    setNailSequence(null);
    setColorLayers(null);

    try {
      let pixels = pixelsRef.current;
      if (!pixels) {
        const result = await prepareImage(imageUri, frameShape);
        pixels = result.pixels;
        pixelsRef.current = pixels;
      }

      const nails = computeNailPositions(frameShape, nailCount);
      setNailPositions(nails);
      const gray = toGrayscale(pixels, WORKING_SIZE);

      if (mode === 'bw') {
        const sequence = await computeStringArt(gray, nails, stringCount, (p) => {
          setProgress(p.percent);
        });
        setNailSequence(sequence);
      } else {
        const layers = buildColorLayers(pixels, WORKING_SIZE, selectedPalette);
        const results: { color: string; nailSequence: number[] }[] = [];

        for (let i = 0; i < selectedPalette.length; i++) {
          const sequence = await computeStringArt(
            layers[i],
            nails,
            Math.round(stringCount / selectedPalette.length),
            (p) => {
              const overall = Math.round(
                ((i / selectedPalette.length) + p.percent / 100 / selectedPalette.length) * 100,
              );
              setProgress(overall);
            },
          );
          results.push({ color: selectedPalette[i].hex, nailSequence: sequence });
        }
        setColorLayers(results);
      }
    } catch (err: any) {
      Alert.alert('Generation failed', err.message ?? 'Unknown error');
    }

    setGenerating(false);
    setProgress(100);
    setStep('preview');
  }

  async function handleSave() {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Upload original image using ImageManipulator for reliable base64 reading
      let originalImageUrl: string | null = null;
      if (imageUri) {
        const resized = await ImageManipulator.manipulateAsync(
          imageUri,
          [{ resize: { width: 1200, height: 1200 } }],
          { format: ImageManipulator.SaveFormat.JPEG, compress: 0.85, base64: true },
        );
        if (!resized?.base64) throw new Error('Could not read image data for upload');

        const filename = `${user.id}/${Date.now()}.jpg`;
        const bytes = Uint8Array.from(atob(resized.base64), (c) => c.charCodeAt(0));
        const { error: uploadError } = await supabase.storage
          .from('project-images')
          .upload(filename, bytes, { contentType: 'image/jpeg' });

        if (!uploadError) {
          const { data: urlData } = supabase.storage
            .from('project-images')
            .getPublicUrl(filename);
          originalImageUrl = urlData?.publicUrl ?? null;
        }
      }

      const { data, error } = await supabase
        .from('projects')
        .insert({
          user_id: user.id,
          title: title || 'Untitled Project',
          mode,
          frame_shape: frameShape,
          nail_count: nailCount,
          string_count: stringCount,
          frame_dimensions: { width: widthCm, height: heightCm },
          nail_sequence: nailSequence,
          color_layers: colorLayers,
          original_image_url: originalImageUrl,
          current_step: 0,
          current_color_layer: 0,
        })
        .select()
        .single();

      if (error) throw error;

      router.replace(`/(app)/project/${data.id}/guide`);
    } catch (err: any) {
      Alert.alert('Save failed', err.message ?? 'Unknown error');
    }
    setSaving(false);
  }

  // ---- Render ----

  const stepIdx = STEP_ORDER.indexOf(step);
  const showBackInHeader = step !== 'generate';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        {showBackInHeader ? (
          <TouchableOpacity onPress={handleBack} style={styles.headerSide}>
            <Text style={styles.back}>{stepIdx <= 0 ? 'Cancel' : '← Back'}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerSide} />
        )}
        <Text style={styles.headerTitle}>New Project</Text>
        <TouchableOpacity onPress={() => router.replace('/(app)')} style={styles.headerSide}>
          <Text style={styles.homeBtn}>Home</Text>
        </TouchableOpacity>
      </View>

      {/* Step indicator */}
      <View style={styles.stepRow}>
        {STEP_ORDER.map((s, i) => (
          <View
            key={s}
            style={[
              styles.stepDot,
              step === s && styles.stepDotActive,
              stepIdx > i && styles.stepDotDone,
            ]}
          />
        ))}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {step === 'frame' && (
          <FrameStep
            shape={frameShape} setShape={setFrameShape}
            diameter={frameDiameter} setDiameter={setFrameDiameter}
            width={frameWidth} setWidth={setFrameWidth}
            height={frameHeight} setHeight={setFrameHeight}
            onNext={() => setStep('image')}
            colors={colors}
            styles={styles}
          />
        )}

        {step === 'image' && (
          <ImageStep
            imageUri={imageUri}
            onPickGallery={handlePickImage}
            onPickCamera={handleCameraImage}
            onNext={handleProceedToSettings}
            colors={colors}
            styles={styles}
          />
        )}

        {step === 'settings' && (
          <SettingsStep
            title={title} setTitle={setTitle}
            mode={mode} setMode={setMode}
            nailCount={nailCount} setNailCount={setNailCount}
            stringCount={stringCount} setStringCount={setStringCount}
            recommendedNails={recommendedNails}
            recommendedStrings={recommendedStrings}
            selectedPalette={selectedPalette}
            setSelectedPalette={setSelectedPalette}
            frameShape={frameShape}
            widthCm={widthCm}
            heightCm={heightCm}
            onNext={() => { setStep('generate'); handleGenerate(); }}
            colors={colors}
            styles={styles}
          />
        )}

        {step === 'generate' && (
          <GenerateStep
            progress={progress}
            generating={generating}
            colors={colors}
            styles={styles}
          />
        )}

        {step === 'preview' && (
          <PreviewStep
            imageUri={imageUri}
            nailSequence={nailSequence}
            colorLayers={colorLayers}
            nailPositions={nailPositions}
            frameShape={frameShape}
            nailCount={nailCount}
            stringCount={stringCount}
            saving={saving}
            onRegenerate={() => { setStep('generate'); handleGenerate(); }}
            onAdjust={() => setStep('settings')}
            onSave={handleSave}
            colors={colors}
            styles={styles}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---- Sub-components ----

function FrameStep({ shape, setShape, diameter, setDiameter, width, setWidth, height, setHeight, onNext, colors, styles }: any) {
  return (
    <View>
      <Text style={styles.sectionTitle}>Step 1 — Frame Setup</Text>
      <Text style={styles.label}>Frame shape</Text>
      <View style={styles.segmentRow}>
        {(['circle', 'square', 'rectangle'] as FrameShape[]).map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.segment, shape === s && styles.segmentActive]}
            onPress={() => setShape(s)}
          >
            <Text style={[styles.segmentText, shape === s && styles.segmentTextActive]}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {shape === 'circle' && (
        <>
          <Text style={styles.label}>Diameter (cm)</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={diameter}
            onChangeText={setDiameter}
            placeholder="e.g. 30"
            placeholderTextColor={colors.placeholder}
          />
        </>
      )}
      {(shape === 'square' || shape === 'rectangle') && (
        <>
          <Text style={styles.label}>Width (cm)</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={width}
            onChangeText={setWidth}
            placeholder="e.g. 30"
            placeholderTextColor={colors.placeholder}
          />
          {shape === 'rectangle' && (
            <>
              <Text style={styles.label}>Height (cm)</Text>
              <TextInput
                style={styles.input}
                keyboardType="decimal-pad"
                value={height}
                onChangeText={setHeight}
                placeholder="e.g. 40"
                placeholderTextColor={colors.placeholder}
              />
            </>
          )}
        </>
      )}

      <TouchableOpacity style={styles.primaryBtn} onPress={onNext}>
        <Text style={styles.primaryBtnText}>Next →</Text>
      </TouchableOpacity>
    </View>
  );
}

function ImageStep({ imageUri, onPickGallery, onPickCamera, onNext, colors, styles }: any) {
  return (
    <View>
      <Text style={styles.sectionTitle}>Step 2 — Choose Image</Text>
      <View style={styles.imageRow}>
        <TouchableOpacity style={styles.imageBtn} onPress={onPickGallery}>
          <Text style={styles.imageBtnIcon}>🖼</Text>
          <Text style={styles.imageBtnText}>Gallery</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.imageBtn} onPress={onPickCamera}>
          <Text style={styles.imageBtnIcon}>📷</Text>
          <Text style={styles.imageBtnText}>Camera</Text>
        </TouchableOpacity>
      </View>

      {imageUri && (
        <Image source={{ uri: imageUri }} style={styles.imagePreview} resizeMode="cover" />
      )}

      <TouchableOpacity style={styles.primaryBtn} onPress={onNext} disabled={!imageUri}>
        <Text style={[styles.primaryBtnText, !imageUri && { opacity: 0.4 }]}>
          Analyze & Next →
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function SettingsStep({
  title, setTitle, mode, setMode, nailCount, setNailCount, stringCount, setStringCount,
  recommendedNails, recommendedStrings, selectedPalette, setSelectedPalette,
  frameShape, widthCm, heightCm,
  onNext, colors, styles,
}: any) {
  const spacingMm = getNailSpacingMm(frameShape, widthCm, heightCm, nailCount);
  const maxNails = maxNailsForFrame(frameShape, widthCm, heightCm);
  const nailsWontFit = nailCount > maxNails;

  let fitLabel = '';
  let fitColor = colors.success;
  if (nailsWontFit) {
    fitLabel = `Too tight! Nails won't fit (${spacingMm.toFixed(1)}mm spacing). Max ~${maxNails} nails for this frame.`;
    fitColor = colors.danger;
  } else if (spacingMm < 8) {
    fitLabel = `Tight spacing (${spacingMm.toFixed(1)}mm). Precise nail placement needed.`;
    fitColor = '#f59e0b';
  } else {
    fitLabel = `Good spacing (${spacingMm.toFixed(1)}mm between nails).`;
    fitColor = colors.success;
  }

  return (
    <View>
      <Text style={styles.sectionTitle}>Step 3 — Settings</Text>

      <Text style={styles.label}>Project name</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. Sunset Portrait"
        placeholderTextColor={colors.placeholder}
      />

      <Text style={styles.label}>Thread mode</Text>
      <View style={styles.segmentRow}>
        {(['bw', 'color'] as ThreadMode[]).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.segment, mode === m && styles.segmentActive]}
            onPress={() => setMode(m)}
          >
            <Text style={[styles.segmentText, mode === m && styles.segmentTextActive]}>
              {m === 'bw' ? 'Black & White' : 'Color'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {mode === 'color' && (
        <>
          <Text style={styles.label}>Color palette</Text>
          <View style={styles.segmentRow}>
            {Object.entries(PRESET_PALETTES).map(([key, palette]) => (
              <TouchableOpacity
                key={key}
                style={[styles.segment, selectedPalette === palette && styles.segmentActive]}
                onPress={() => setSelectedPalette(palette)}
              >
                <Text style={[styles.segmentText, selectedPalette === palette && styles.segmentTextActive]}>
                  {key.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.palettePreview}>
            {selectedPalette.map((c: ThreadColor) => (
              <View key={c.hex} style={styles.paletteChip}>
                <View style={[styles.paletteColor, { backgroundColor: c.hex, borderWidth: c.hex === '#FFFFFF' ? 1 : 0, borderColor: colors.border }]} />
                <Text style={styles.paletteLabel}>{c.name}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      <Text style={styles.label}>
        Nails: <Text style={styles.valueLabel}>{nailCount}</Text>
        {nailCount === recommendedNails && <Text style={styles.recommended}> (recommended)</Text>}
      </Text>
      <Slider
        style={{ height: 40 }}
        minimumValue={80}
        maximumValue={400}
        step={10}
        value={nailCount}
        onValueChange={setNailCount}
        minimumTrackTintColor={colors.accent}
        maximumTrackTintColor={colors.border}
        thumbTintColor={colors.accent}
      />

      {/* Nail fit indicator */}
      <View style={[styles.fitBanner, { borderLeftColor: fitColor }]}>
        <Text style={[styles.fitText, { color: fitColor }]}>{fitLabel}</Text>
        {nailsWontFit && (
          <Text style={[styles.fitText, { color: colors.subtext, marginTop: 4 }]}>
            Increase frame size or reduce nail count.
          </Text>
        )}
      </View>

      <Text style={styles.label}>
        Strings: <Text style={styles.valueLabel}>{stringCount}</Text>
        {stringCount === recommendedStrings && <Text style={styles.recommended}> (recommended)</Text>}
      </Text>
      <Slider
        style={{ height: 40 }}
        minimumValue={1000}
        maximumValue={6000}
        step={100}
        value={stringCount}
        onValueChange={setStringCount}
        minimumTrackTintColor={colors.accent}
        maximumTrackTintColor={colors.border}
        thumbTintColor={colors.accent}
      />

      <View style={styles.tip}>
        <Text style={styles.tipText}>
          More strings = more detail. The preview will show the exact result before you start.
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.primaryBtn, nailsWontFit && { opacity: 0.5 }]}
        onPress={onNext}
        disabled={nailsWontFit}
      >
        <Text style={styles.primaryBtnText}>Generate →</Text>
      </TouchableOpacity>
    </View>
  );
}

function GenerateStep({ progress, generating, colors, styles }: any) {
  return (
    <View style={styles.generateContainer}>
      <ActivityIndicator size="large" color={colors.accent} />
      <Text style={styles.generateTitle}>Generating thread art…</Text>
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${progress}%` }]} />
      </View>
      <Text style={styles.progressLabel}>{progress}%</Text>
      <Text style={styles.generateSubtext}>
        Running the string art algorithm on your device. This may take a few seconds.
      </Text>
    </View>
  );
}

function PreviewStep({ imageUri, nailSequence, colorLayers, nailPositions, frameShape, nailCount, stringCount, saving, onRegenerate, onAdjust, onSave, colors, styles }: any) {
  const totalStrings = nailSequence ? nailSequence.length - 1 : colorLayers?.reduce((a: number, l: any) => a + l.nailSequence.length - 1, 0) ?? 0;

  return (
    <View>
      <Text style={styles.sectionTitle}>Step 5 — Preview & Save</Text>
      <Text style={styles.previewInfo}>
        {totalStrings.toLocaleString()} strings computed across {nailCount} nails.
      </Text>
      <ThreadPreview
        shape={frameShape}
        nailPositions={nailPositions}
        nailSequence={nailSequence}
        colorLayers={colorLayers}
        size={320}
      />
      <Text style={styles.tip2}>
        The preview shows the exact strings you will make physically. Happy with it? Save and start. Need changes? Adjust settings or regenerate.
      </Text>
      <TouchableOpacity style={styles.primaryBtn} onPress={onSave} disabled={saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Save & Start Guiding →</Text>}
      </TouchableOpacity>
      <View style={styles.regenerateRow}>
        <TouchableOpacity style={[styles.outlineBtn, { flex: 1 }]} onPress={onAdjust}>
          <Text style={styles.outlineBtnText}>← Adjust Settings</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.outlineBtn, { flex: 1 }]} onPress={onRegenerate}>
          <Text style={styles.outlineBtnText}>Regenerate</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ---- Style factory ----

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerSide: { width: 70 },
    back: { color: colors.accentText, fontSize: 16 },
    homeBtn: { color: colors.subtext, fontSize: 14, textAlign: 'right' },
    headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
    stepRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 14 },
    stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
    stepDotActive: { backgroundColor: colors.accent, width: 20 },
    stepDotDone: { backgroundColor: colors.accentMuted },
    scroll: { flex: 1 },
    scrollContent: { padding: 20, paddingBottom: 60 },
    sectionTitle: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: 20 },
    label: { color: colors.subtext, fontSize: 14, marginBottom: 6, marginTop: 12 },
    valueLabel: { color: colors.text, fontWeight: '700' },
    recommended: { color: colors.accent, fontSize: 12 },
    input: {
      backgroundColor: colors.inputBg,
      borderRadius: 10,
      padding: 14,
      color: colors.text,
      fontSize: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    segmentRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
    segment: {
      flex: 1,
      padding: 12,
      borderRadius: 10,
      backgroundColor: colors.surface,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    segmentActive: { backgroundColor: colors.accentMuted, borderColor: colors.accent },
    segmentText: { color: colors.subtext, fontSize: 13, fontWeight: '600' },
    segmentTextActive: { color: colors.text },
    imageRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
    imageBtn: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 20,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    imageBtnIcon: { fontSize: 32, marginBottom: 8 },
    imageBtnText: { color: colors.subtext, fontSize: 14, fontWeight: '600' },
    imagePreview: { width: '100%', aspectRatio: 1, borderRadius: 14, marginBottom: 20 },
    primaryBtn: {
      backgroundColor: colors.accent,
      borderRadius: 12,
      padding: 16,
      alignItems: 'center',
      marginTop: 20,
    },
    primaryBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
    outlineBtn: {
      padding: 14,
      alignItems: 'center',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      marginTop: 10,
    },
    outlineBtnText: { color: colors.subtext, fontSize: 14, fontWeight: '600' },
    regenerateRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
    tip: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: 10,
      padding: 12,
      marginTop: 16,
      borderLeftWidth: 3,
      borderLeftColor: colors.accent,
    },
    tipText: { color: colors.subtext, fontSize: 13, lineHeight: 20 },
    fitBanner: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: 10,
      padding: 10,
      marginTop: 4,
      marginBottom: 8,
      borderLeftWidth: 3,
    },
    fitText: { fontSize: 13, lineHeight: 18 },
    generateContainer: { alignItems: 'center', paddingTop: 60, gap: 20 },
    generateTitle: { color: colors.text, fontSize: 22, fontWeight: '700' },
    progressBar: { width: '100%', height: 8, backgroundColor: colors.surface, borderRadius: 4, overflow: 'hidden' },
    progressFill: { height: '100%', backgroundColor: colors.accent, borderRadius: 4 },
    progressLabel: { color: colors.subtext, fontSize: 14 },
    generateSubtext: { color: colors.subtextMuted, fontSize: 13, textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 },
    previewInfo: { color: colors.subtext, fontSize: 14, marginBottom: 16 },
    tip2: { color: colors.subtext, fontSize: 13, lineHeight: 20, marginBottom: 8, marginTop: 12 },
    palettePreview: { flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 4 },
    paletteChip: { alignItems: 'center', gap: 4 },
    paletteColor: { width: 28, height: 28, borderRadius: 14 },
    paletteLabel: { color: colors.subtext, fontSize: 10 },
  });
}
