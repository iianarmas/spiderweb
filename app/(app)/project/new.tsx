import { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import Slider from '@react-native-community/slider';
import { useRouter } from 'expo-router';
import { supabase } from '../../../src/lib/supabase';
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

type WizardStep = 'frame' | 'image' | 'settings' | 'generate' | 'preview';

export default function NewProjectScreen() {
  const router = useRouter();

  // Wizard state
  const [step, setStep] = useState<WizardStep>('frame');

  // Frame setup
  const [frameShape, setFrameShape] = useState<FrameShape>('circle');
  const [frameDiameter, setFrameDiameter] = useState('30'); // cm (circle)
  const [frameWidth, setFrameWidth] = useState('30');       // cm (rect/square)
  const [frameHeight, setFrameHeight] = useState('30');     // cm

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

  // Saving
  const [saving, setSaving] = useState(false);

  // Computed pixels (kept across generate calls)
  const pixelsRef = useRef<Uint8ClampedArray | null>(null);

  async function handlePickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
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

    // Compute recommendations based on frame dimensions and image edge density
    try {
      const widthCm = frameShape === 'circle' ? parseFloat(frameDiameter) : parseFloat(frameWidth);
      const heightCm = frameShape === 'circle' ? parseFloat(frameDiameter) : parseFloat(frameHeight);
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
      const gray = toGrayscale(pixels, WORKING_SIZE);

      if (mode === 'bw') {
        const sequence = await computeStringArt(gray, nails, stringCount, (p) => {
          setProgress(p.percent);
        });
        setNailSequence(sequence);
      } else {
        // Color mode: run algorithm for each color layer
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

      // Upload original image to Supabase Storage
      let originalImageUrl: string | null = null;
      if (imageUri) {
        const ext = imageUri.split('.').pop() ?? 'jpg';
        const filename = `${user.id}/${Date.now()}.${ext}`;
        const response = await fetch(imageUri);
        const blob = await response.blob();
        const { error: uploadError } = await supabase.storage
          .from('project-images')
          .upload(filename, blob, { contentType: `image/${ext}` });
        if (!uploadError) {
          const { data: { publicUrl } } = supabase.storage
            .from('project-images')
            .getPublicUrl(filename);
          originalImageUrl = publicUrl;
        }
      }

      const widthCm = frameShape === 'circle' ? parseFloat(frameDiameter) : parseFloat(frameWidth);
      const heightCm = frameShape === 'circle' ? parseFloat(frameDiameter) : parseFloat(frameHeight);

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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Project</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Step indicator */}
      <View style={styles.stepRow}>
        {(['frame', 'image', 'settings', 'generate', 'preview'] as WizardStep[]).map((s, i) => (
          <View
            key={s}
            style={[
              styles.stepDot,
              step === s && styles.stepDotActive,
              ['frame', 'image', 'settings', 'generate', 'preview'].indexOf(step) > i && styles.stepDotDone,
            ]}
          />
        ))}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {step === 'frame' && <FrameStep
          shape={frameShape} setShape={setFrameShape}
          diameter={frameDiameter} setDiameter={setFrameDiameter}
          width={frameWidth} setWidth={setFrameWidth}
          height={frameHeight} setHeight={setFrameHeight}
          onNext={() => setStep('image')}
        />}

        {step === 'image' && <ImageStep
          imageUri={imageUri}
          onPickGallery={handlePickImage}
          onPickCamera={handleCameraImage}
          onNext={handleProceedToSettings}
          onBack={() => setStep('frame')}
        />}

        {step === 'settings' && <SettingsStep
          title={title} setTitle={setTitle}
          mode={mode} setMode={setMode}
          nailCount={nailCount} setNailCount={setNailCount}
          stringCount={stringCount} setStringCount={setStringCount}
          recommendedNails={recommendedNails}
          recommendedStrings={recommendedStrings}
          selectedPalette={selectedPalette}
          setSelectedPalette={setSelectedPalette}
          onNext={() => { setStep('generate'); handleGenerate(); }}
          onBack={() => setStep('image')}
        />}

        {step === 'generate' && <GenerateStep
          progress={progress}
          generating={generating}
        />}

        {step === 'preview' && <PreviewStep
          imageUri={imageUri}
          nailSequence={nailSequence}
          colorLayers={colorLayers}
          nailCount={nailCount}
          stringCount={stringCount}
          saving={saving}
          onRegenerate={() => { setStep('generate'); handleGenerate(); }}
          onSave={handleSave}
        />}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---- Sub-components for each wizard step ----

function FrameStep({ shape, setShape, diameter, setDiameter, width, setWidth, height, setHeight, onNext }: any) {
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
            placeholderTextColor="#666"
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
            placeholderTextColor="#666"
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
                placeholderTextColor="#666"
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

function ImageStep({ imageUri, onPickGallery, onPickCamera, onNext, onBack }: any) {
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
      <TouchableOpacity style={styles.secondaryBtn} onPress={onBack}>
        <Text style={styles.secondaryBtnText}>← Back</Text>
      </TouchableOpacity>
    </View>
  );
}

function SettingsStep({
  title, setTitle, mode, setMode, nailCount, setNailCount, stringCount, setStringCount,
  recommendedNails, recommendedStrings, selectedPalette, setSelectedPalette, onNext, onBack,
}: any) {
  return (
    <View>
      <Text style={styles.sectionTitle}>Step 3 — Settings</Text>

      <Text style={styles.label}>Project name</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. Sunset Portrait"
        placeholderTextColor="#666"
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
                <View style={[styles.paletteColor, { backgroundColor: c.hex, borderWidth: c.hex === '#FFFFFF' ? 1 : 0 }]} />
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
        minimumTrackTintColor="#7c4dff"
        maximumTrackTintColor="#3a3a5a"
        thumbTintColor="#7c4dff"
      />

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
        minimumTrackTintColor="#7c4dff"
        maximumTrackTintColor="#3a3a5a"
        thumbTintColor="#7c4dff"
      />

      <View style={styles.tip}>
        <Text style={styles.tipText}>
          More strings = more detail. The preview will show the exact result before you start.
        </Text>
      </View>

      <TouchableOpacity style={styles.primaryBtn} onPress={onNext}>
        <Text style={styles.primaryBtnText}>Generate →</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryBtn} onPress={onBack}>
        <Text style={styles.secondaryBtnText}>← Back</Text>
      </TouchableOpacity>
    </View>
  );
}

function GenerateStep({ progress, generating }: any) {
  return (
    <View style={styles.generateContainer}>
      <ActivityIndicator size="large" color="#7c4dff" />
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

function PreviewStep({ imageUri, nailSequence, colorLayers, nailCount, stringCount, saving, onRegenerate, onSave }: any) {
  const totalStrings = nailSequence ? nailSequence.length - 1 : colorLayers?.reduce((a: number, l: any) => a + l.nailSequence.length - 1, 0) ?? 0;

  return (
    <View>
      <Text style={styles.sectionTitle}>Step 5 — Preview & Accuracy</Text>
      <Text style={styles.previewInfo}>
        {totalStrings.toLocaleString()} strings computed across {nailCount} nails.
      </Text>
      <View style={styles.previewPlaceholder}>
        <Text style={styles.previewPlaceholderText}>
          Thread art preview renders here{'\n'}(Skia canvas — see ThreadPreview component)
        </Text>
      </View>
      <Text style={styles.tip2}>
        The preview above shows the exact strings you will make physically. If it looks good, save and start. If you want more detail, increase strings and regenerate.
      </Text>
      <TouchableOpacity style={styles.primaryBtn} onPress={onSave} disabled={saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Save & Start Guiding →</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryBtn} onPress={onRegenerate}>
        <Text style={styles.secondaryBtnText}>Adjust & Regenerate</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a4a',
  },
  back: { color: '#b89eff', fontSize: 16, width: 60 },
  headerTitle: { color: '#e0c9ff', fontSize: 18, fontWeight: '700' },
  stepRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3a3a5a' },
  stepDotActive: { backgroundColor: '#7c4dff', width: 20 },
  stepDotDone: { backgroundColor: '#4a2aaa' },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 60 },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: '#e0c9ff', marginBottom: 20 },
  label: { color: '#9b8ab8', fontSize: 14, marginBottom: 6, marginTop: 12 },
  valueLabel: { color: '#e0c9ff', fontWeight: '700' },
  recommended: { color: '#7c4dff', fontSize: 12 },
  input: {
    backgroundColor: '#2a2a4a',
    borderRadius: 10,
    padding: 14,
    color: '#fff',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#3a3a5a',
  },
  segmentRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  segment: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#2a2a4a',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3a3a5a',
  },
  segmentActive: { backgroundColor: '#3d2b6b', borderColor: '#7c4dff' },
  segmentText: { color: '#9b8ab8', fontSize: 13, fontWeight: '600' },
  segmentTextActive: { color: '#e0c9ff' },
  imageRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  imageBtn: {
    flex: 1,
    backgroundColor: '#2a2a4a',
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3a3a5a',
  },
  imageBtnIcon: { fontSize: 32, marginBottom: 8 },
  imageBtnText: { color: '#9b8ab8', fontSize: 14, fontWeight: '600' },
  imagePreview: { width: '100%', aspectRatio: 1, borderRadius: 14, marginBottom: 20 },
  primaryBtn: {
    backgroundColor: '#7c4dff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  primaryBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  secondaryBtn: {
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  secondaryBtnText: { color: '#9b8ab8', fontSize: 15 },
  tip: {
    backgroundColor: '#1e1e3a',
    borderRadius: 10,
    padding: 12,
    marginTop: 16,
    borderLeftWidth: 3,
    borderLeftColor: '#7c4dff',
  },
  tipText: { color: '#9b8ab8', fontSize: 13, lineHeight: 20 },
  generateContainer: { alignItems: 'center', paddingTop: 60, gap: 20 },
  generateTitle: { color: '#e0c9ff', fontSize: 22, fontWeight: '700' },
  progressBar: { width: '100%', height: 8, backgroundColor: '#2a2a4a', borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#7c4dff', borderRadius: 4 },
  progressLabel: { color: '#9b8ab8', fontSize: 14 },
  generateSubtext: { color: '#6a6a8a', fontSize: 13, textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 },
  previewInfo: { color: '#9b8ab8', fontSize: 14, marginBottom: 16 },
  previewPlaceholder: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#0d0d1a',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#3a3a5a',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  previewPlaceholderText: { color: '#4a4a6a', textAlign: 'center', fontSize: 13, lineHeight: 22 },
  tip2: { color: '#9b8ab8', fontSize: 13, lineHeight: 20, marginBottom: 8 },
  palettePreview: { flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 4 },
  paletteChip: { alignItems: 'center', gap: 4 },
  paletteColor: { width: 28, height: 28, borderRadius: 14, borderColor: '#555' },
  paletteLabel: { color: '#9b8ab8', fontSize: 10 },
});
