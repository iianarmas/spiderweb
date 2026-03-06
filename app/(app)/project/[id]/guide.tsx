import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../../src/lib/supabase';
import { useProjectStore, Project } from '../../../../src/store/projectStore';
import { NailCircle } from '../../../../src/components/NailCircle';
import { computeNailPositions } from '../../../../src/algorithm/stringArt';
import { NailPosition } from '../../../../src/algorithm/stringArt';

export default function GuideScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { activeProject, setActiveProject, updateActiveProjectStep } = useProjectStore();

  const [project, setProject] = useState<Project | null>(activeProject);
  const [loading, setLoading] = useState(!activeProject);
  const [saving, setSaving] = useState(false);
  const [nailPositions, setNailPositions] = useState<NailPosition[]>([]);

  useEffect(() => {
    if (!activeProject || activeProject.id !== id) {
      fetchProject();
    } else {
      initNails(activeProject);
    }
  }, [id]);

  function initNails(p: Project) {
    const positions = computeNailPositions(p.frameShape, p.nailCount);
    setNailPositions(positions);
  }

  async function fetchProject() {
    setLoading(true);
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      Alert.alert('Error', error.message);
      router.back();
      return;
    }

    const p: Project = {
      id: data.id,
      title: data.title,
      mode: data.mode,
      frameShape: data.frame_shape,
      nailCount: data.nail_count,
      stringCount: data.string_count,
      frameDimensions: data.frame_dimensions,
      nailSequence: data.nail_sequence,
      colorLayers: data.color_layers,
      originalImageUri: data.original_image_url,
      previewImageUrl: data.preview_image_url,
      currentStep: data.current_step ?? 0,
      currentColorLayer: data.current_color_layer ?? 0,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
    setProject(p);
    setActiveProject(p);
    initNails(p);
    setLoading(false);
  }

  // Get the current nail sequence (handles B&W and color modes)
  function getCurrentSequence(p: Project): number[] | null {
    if (p.mode === 'bw') return p.nailSequence;
    if (p.colorLayers && p.currentColorLayer < p.colorLayers.length) {
      return p.colorLayers[p.currentColorLayer].nailSequence;
    }
    return null;
  }

  // Current and next nail indices
  function getCurrentNails(p: Project): { from: number; to: number } | null {
    const seq = getCurrentSequence(p);
    if (!seq || p.currentStep >= seq.length - 1) return null;
    return { from: seq[p.currentStep], to: seq[p.currentStep + 1] };
  }

  // Total strings for current color layer (or B&W)
  function getTotalInCurrentPhase(p: Project): number {
    const seq = getCurrentSequence(p);
    return seq ? seq.length - 1 : 0;
  }

  // History: last 5 completed steps
  function getRecentHistory(p: Project): { from: number; to: number }[] {
    const seq = getCurrentSequence(p);
    if (!seq || p.currentStep === 0) return [];
    const history: { from: number; to: number }[] = [];
    for (let i = Math.max(0, p.currentStep - 5); i < p.currentStep; i++) {
      history.push({ from: seq[i], to: seq[i + 1] });
    }
    return history.reverse();
  }

  const handleDone = useCallback(async () => {
    if (!project) return;
    const seq = getCurrentSequence(project);
    if (!seq) return;

    let newStep = project.currentStep + 1;
    let newColorLayer = project.currentColorLayer;

    // Check if current color layer is done
    if (project.mode === 'color' && newStep >= seq.length - 1) {
      if (newColorLayer + 1 < (project.colorLayers?.length ?? 0)) {
        // Move to next color layer
        newColorLayer += 1;
        newStep = 0;
      }
    }

    const updated: Project = {
      ...project,
      currentStep: newStep,
      currentColorLayer: newColorLayer,
    };
    setProject(updated);
    setActiveProject(updated);
    updateActiveProjectStep(newStep, newColorLayer);

    // Auto-save to Supabase
    setSaving(true);
    await supabase
      .from('projects')
      .update({ current_step: newStep, current_color_layer: newColorLayer, updated_at: new Date().toISOString() })
      .eq('id', project.id);
    setSaving(false);
  }, [project]);

  if (loading || !project) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#7c4dff" />
      </View>
    );
  }

  const currentNails = getCurrentNails(project);
  const totalInPhase = getTotalInCurrentPhase(project);
  const history = getRecentHistory(project);
  const seq = getCurrentSequence(project);
  const isCompleted = !currentNails;

  const phaseName = project.mode === 'color' && project.colorLayers
    ? project.colorLayers[project.currentColorLayer]?.color ?? ''
    : null;

  const completedPairs: [number, number][] = [];
  if (seq) {
    for (let i = 0; i < project.currentStep && i < seq.length - 1; i++) {
      completedPairs.push([seq[i], seq[i + 1]]);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{project.title}</Text>
        {saving ? (
          <ActivityIndicator size="small" color="#7c4dff" style={{ width: 60 }} />
        ) : (
          <Text style={styles.savedLabel}>Saved</Text>
        )}
      </View>

      {/* Phase indicator for color mode */}
      {project.mode === 'color' && project.colorLayers && (
        <View style={styles.phaseBanner}>
          <Text style={styles.phaseText}>
            Phase {project.currentColorLayer + 1} of {project.colorLayers.length}
            {phaseName ? ` — ` : ''}
          </Text>
          {phaseName && (
            <View style={[styles.phaseColorDot, { backgroundColor: phaseName }]} />
          )}
          {phaseName && (
            <Text style={styles.phaseColorName}>
              {project.colorLayers[project.currentColorLayer] &&
                ` ${project.colorLayers[project.currentColorLayer].color} thread`}
            </Text>
          )}
        </View>
      )}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Frame diagram */}
        <View style={styles.diagramContainer}>
          <NailCircle
            shape={project.frameShape}
            nailPositions={nailPositions}
            completedPairs={completedPairs}
            currentFrom={currentNails?.from ?? -1}
            currentTo={currentNails?.to ?? -1}
            size={320}
          />
        </View>

        {isCompleted ? (
          <View style={styles.completedBox}>
            <Text style={styles.completedEmoji}>🎉</Text>
            <Text style={styles.completedTitle}>
              {project.mode === 'color' && project.currentColorLayer < (project.colorLayers?.length ?? 0) - 1
                ? 'Phase complete! Move to next color.'
                : 'All done! Your thread art is complete.'}
            </Text>
          </View>
        ) : (
          <>
            {/* Main instruction */}
            <View style={styles.instructionBox}>
              <Text style={styles.instructionLabel}>Wrap string</Text>
              <View style={styles.nailRow}>
                <View style={styles.nailBadgeFrom}>
                  <Text style={styles.nailBadgeText}>Nail {(currentNails?.from ?? 0) + 1}</Text>
                </View>
                <Text style={styles.arrow}>→</Text>
                <View style={styles.nailBadgeTo}>
                  <Text style={styles.nailBadgeText}>Nail {(currentNails?.to ?? 0) + 1}</Text>
                </View>
              </View>
            </View>

            {/* Progress bar */}
            <View style={styles.progressRow}>
              <View style={styles.progressBar}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.round((project.currentStep / Math.max(totalInPhase, 1)) * 100)}%` },
                  ]}
                />
              </View>
              <Text style={styles.progressLabel}>
                {project.currentStep} / {totalInPhase}
              </Text>
            </View>

            {/* Done button */}
            <TouchableOpacity style={styles.doneBtn} onPress={handleDone}>
              <Text style={styles.doneBtnText}>Done — Next Step →</Text>
            </TouchableOpacity>
          </>
        )}

        {/* Step history */}
        {history.length > 0 && (
          <View style={styles.historySection}>
            <Text style={styles.historyTitle}>Recent steps</Text>
            {history.map((h, i) => (
              <View key={i} style={styles.historyRow}>
                <Text style={styles.historyCheck}>✓</Text>
                <Text style={styles.historyText}>
                  Nail {h.from + 1} → Nail {h.to + 1}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a2e' },
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
  headerTitle: { color: '#e0c9ff', fontSize: 17, fontWeight: '700', flex: 1, textAlign: 'center' },
  savedLabel: { color: '#4caf50', fontSize: 12, width: 60, textAlign: 'right' },
  phaseBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a4a',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#3a3a5a',
  },
  phaseText: { color: '#9b8ab8', fontSize: 13 },
  phaseColorDot: { width: 12, height: 12, borderRadius: 6, marginRight: 4 },
  phaseColorName: { color: '#9b8ab8', fontSize: 13 },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, gap: 16, paddingBottom: 40 },
  diagramContainer: { alignItems: 'center' },
  instructionBox: {
    backgroundColor: '#2a2a4a',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3a3a5a',
    gap: 12,
  },
  instructionLabel: { color: '#9b8ab8', fontSize: 15 },
  nailRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  nailBadgeFrom: {
    backgroundColor: '#1e4d3a',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 2,
    borderColor: '#2ecc71',
  },
  nailBadgeTo: {
    backgroundColor: '#4d1e00',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 2,
    borderColor: '#ff8c00',
  },
  nailBadgeText: { color: '#fff', fontSize: 20, fontWeight: '800' },
  arrow: { color: '#9b8ab8', fontSize: 28, fontWeight: '300' },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  progressBar: { flex: 1, height: 8, backgroundColor: '#2a2a4a', borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#7c4dff', borderRadius: 4 },
  progressLabel: { color: '#9b8ab8', fontSize: 13, width: 80, textAlign: 'right' },
  doneBtn: {
    backgroundColor: '#7c4dff',
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    elevation: 4,
  },
  doneBtnText: { color: '#fff', fontSize: 20, fontWeight: '800' },
  completedBox: { alignItems: 'center', padding: 40, gap: 16 },
  completedEmoji: { fontSize: 64 },
  completedTitle: { color: '#e0c9ff', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  historySection: { marginTop: 8 },
  historyTitle: { color: '#6a6a8a', fontSize: 12, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  historyCheck: { color: '#4caf50', fontSize: 14 },
  historyText: { color: '#6a6a8a', fontSize: 14 },
});
