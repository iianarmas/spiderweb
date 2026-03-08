import { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Image,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../../src/lib/supabase';
import { useProjectStore, Project, FrameShape } from '../../../../src/store/projectStore';
import { useTheme, ThemeColors } from '../../../../src/theme';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

/** Compute nail distribution per section for placement guidance. */
function getNailSections(shape: FrameShape, nailCount: number) {
  if (shape === 'circle') {
    // Divide circle into 4 quadrants (starting from top, going clockwise)
    const perQuadrant = Math.floor(nailCount / 4);
    const remainder = nailCount % 4;
    const sections = [
      { label: 'Top-Right', emoji: '↗' },
      { label: 'Bottom-Right', emoji: '↘' },
      { label: 'Bottom-Left', emoji: '↙' },
      { label: 'Top-Left', emoji: '↖' },
    ];
    let offset = 0;
    return sections.map((s, i) => {
      const count = perQuadrant + (i < remainder ? 1 : 0);
      const from = offset + 1;
      const to = offset + count;
      offset += count;
      return { ...s, count, from, to };
    });
  } else {
    // Square / rectangle: nails divided equally among 4 sides
    const perSide = Math.floor(nailCount / 4);
    const remainder = nailCount % 4;
    const sections = [
      { label: 'Top', emoji: '⬆' },
      { label: 'Right', emoji: '➡' },
      { label: 'Bottom', emoji: '⬇' },
      { label: 'Left', emoji: '⬅' },
    ];
    let offset = 0;
    return sections.map((s, i) => {
      const count = perSide + (i < remainder ? 1 : 0);
      const from = offset + 1;
      const to = offset + count;
      offset += count;
      return { ...s, count, from, to };
    });
  }
}

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { activeProject, setActiveProject } = useProjectStore();
  const [project, setProject] = useState<Project | null>(activeProject);
  const [loading, setLoading] = useState(!activeProject);
  const [showNailGuide, setShowNailGuide] = useState(false);

  useEffect(() => {
    if (!activeProject || activeProject.id !== id) {
      fetchProject();
    }
  }, [id]);

  async function fetchProject() {
    setLoading(true);
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      Alert.alert('Error', error.message);
    } else if (data) {
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
    }
    setLoading(false);
  }

  async function handleDelete() {
    Alert.alert('Delete project', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('projects').delete().eq('id', id);
          setActiveProject(null);
          router.replace('/(app)');
        },
      },
    ]);
  }

  async function handleUploadSequence() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'text/plain',
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;

      setLoading(true);
      const fileUri = result.assets[0].uri;
      const text = await FileSystem.readAsStringAsync(fileUri);

      const numbers = text.match(/\d+/g);
      if (!numbers || numbers.length === 0) {
        Alert.alert('Error', 'No numbers found in the file.');
        setLoading(false);
        return;
      }

      // stringartcreator uses 1-indexed (e.g., 1 to 200), we need 0-indexed internally
      const sequence = numbers.map(n => parseInt(n, 10) - 1);

      if (project) {
        const updated = {
          ...project,
          nailSequence: sequence,
          currentStep: 0,
          colorLayers: null,
          mode: 'bw' as const,
        };

        const { error } = await supabase
          .from('projects')
          .update({
            nail_sequence: sequence,
            current_step: 0,
            color_layers: null,
            mode: 'bw',
            updated_at: new Date().toISOString()
          })
          .eq('id', project.id);

        if (error) {
          Alert.alert('Error', error.message);
        } else {
          setProject(updated as any);
          setActiveProject(updated as any);
          Alert.alert('Success', `Loaded sequence with ${sequence.length} nails.`);
        }
      }
      setLoading(false);
    } catch (e: any) {
      setLoading(false);
      Alert.alert('Error', e.message);
    }
  }

  if (loading || !project) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const totalStrings = project.nailSequence
    ? project.nailSequence.length - 1
    : (project.colorLayers?.reduce((a, l) => a + l.nailSequence.length - 1, 0) ?? 0);

  const pct = totalStrings > 0
    ? Math.min(100, Math.round((project.currentStep / totalStrings) * 100))
    : 0;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/(app)')}>
          <Text style={styles.back}>← Home</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{project.title}</Text>
        <TouchableOpacity onPress={handleDelete}>
          <Text style={styles.deleteBtn}>Delete</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {project.originalImageUri && (
          <Image
            source={{ uri: project.originalImageUri }}
            style={styles.image}
            resizeMode="cover"
          />
        )}

        <View style={styles.infoGrid}>
          <InfoCell label="Shape" value={project.frameShape} colors={colors} styles={styles} />
          <InfoCell label="Mode" value={project.mode === 'bw' ? 'B&W' : 'Color'} colors={colors} styles={styles} />
          <InfoCell label="Nails" value={String(project.nailCount)} colors={colors} styles={styles} />
          <InfoCell label="Strings" value={String(project.stringCount)} colors={colors} styles={styles} />
        </View>

        {/* Nail Placement Guide */}
        <NailPlacementGuide
          shape={project.frameShape}
          nailCount={project.nailCount}
          frameDimensions={project.frameDimensions}
          expanded={showNailGuide}
          onToggle={() => setShowNailGuide(!showNailGuide)}
          colors={colors}
          styles={styles}
        />

        <View style={styles.progressSection}>
          <Text style={styles.progressTitle}>Progress</Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${pct}%` }]} />
          </View>
          <Text style={styles.progressLabel}>
            {project.currentStep} / {totalStrings} strings done ({pct}%)
          </Text>
        </View>

        <TouchableOpacity
          style={styles.guideBtn}
          onPress={() => router.push(`/(app)/project/${id}/guide`)}
        >
          <Text style={styles.guideBtnText}>
            {project.currentStep === 0 ? 'Start Guiding →' : 'Resume Guiding →'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.guideBtn, { backgroundColor: colors.surfaceAlt, marginTop: 12, borderWidth: 1, borderColor: colors.border }]}
          onPress={handleUploadSequence}
        >
          <Text style={[styles.guideBtnText, { color: colors.text }]}>
            Upload Sequence (.txt)
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoCell({ label, value, colors, styles }: { label: string; value: string; colors: ThemeColors; styles: any }) {
  return (
    <View style={styles.infoCell}>
      <Text style={styles.infoCellLabel}>{label}</Text>
      <Text style={styles.infoCellValue}>{value}</Text>
    </View>
  );
}

function NailPlacementGuide({
  shape, nailCount, frameDimensions, expanded, onToggle, colors, styles,
}: {
  shape: FrameShape; nailCount: number; frameDimensions: { width: number; height: number }; expanded: boolean;
  onToggle: () => void; colors: ThemeColors; styles: any;
}) {
  const sections = useMemo(() => getNailSections(shape, nailCount), [shape, nailCount]);
  const isCircle = shape === 'circle';

  const distanceBetweenNails = useMemo(() => {
    let perimeter = 0;
    if (shape === 'circle') {
      perimeter = frameDimensions.width * Math.PI;
    } else if (shape === 'square') {
      perimeter = frameDimensions.width * 4;
    } else {
      perimeter = (frameDimensions.width + frameDimensions.height) * 2;
    }
    return perimeter / nailCount;
  }, [shape, frameDimensions, nailCount]);

  return (
    <View style={styles.nailGuideContainer}>
      <TouchableOpacity style={styles.nailGuideHeader} onPress={onToggle} activeOpacity={0.7}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={styles.nailGuideIcon}>📌</Text>
          <Text style={styles.nailGuideTitle}>Nail Placement Guide</Text>
        </View>
        <Text style={styles.nailGuideChevron}>{expanded ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.nailGuideBody}>
          <Text style={styles.nailGuideSubtitle}>
            {nailCount} nails total — {isCircle ? '4 quadrants' : '4 sides'}
          </Text>
          <Text style={styles.nailGuideDistance}>
            Distance between nails: {distanceBetweenNails.toFixed(2)} cm
          </Text>
          <Text style={styles.nailGuideHint}>
            {isCircle
              ? 'Starting from the top of the circle, going clockwise:'
              : 'Starting from the top-left corner, going clockwise:'}
          </Text>

          {sections.map((section, i) => (
            <View key={i} style={styles.nailGuideRow}>
              <View style={styles.nailGuideLabelBox}>
                <Text style={styles.nailGuideEmoji}>{section.emoji}</Text>
                <Text style={styles.nailGuideSideLabel}>{section.label}</Text>
              </View>
              <View style={styles.nailGuideCountBox}>
                <Text style={styles.nailGuideCount}>{section.count}</Text>
                <Text style={styles.nailGuideCountLabel}>nails</Text>
              </View>
              <View style={styles.nailGuideRangeBox}>
                <Text style={styles.nailGuideRange}>#{section.from} – #{section.to}</Text>
              </View>
            </View>
          ))}

          <View style={styles.nailGuideTip}>
            <Text style={styles.nailGuideTipText}>
              💡 Measure the {isCircle ? 'circumference' : 'perimeter'} and space nails evenly within each section.
              {isCircle
                ? ` Each quadrant covers 90° of the circle.`
                : ` Each side gets its nails distributed from one corner to the next.`}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    back: { color: colors.accentText, fontSize: 16, width: 70 },
    headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700', flex: 1, textAlign: 'center' },
    deleteBtn: { color: colors.danger, fontSize: 14, width: 60, textAlign: 'right' },
    content: { padding: 20, gap: 20 },
    image: { width: '100%', aspectRatio: 1, borderRadius: 16 },
    infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    infoCell: {
      flex: 1,
      minWidth: '45%',
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
    },
    infoCellLabel: { color: colors.subtext, fontSize: 12, marginBottom: 4 },
    infoCellValue: { color: colors.text, fontSize: 18, fontWeight: '700' },
    progressSection: { gap: 8 },
    progressTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
    progressBar: { height: 10, backgroundColor: colors.surface, borderRadius: 5, overflow: 'hidden' },
    progressFill: { height: '100%', backgroundColor: colors.accent, borderRadius: 5 },
    progressLabel: { color: colors.subtext, fontSize: 13 },
    guideBtn: {
      backgroundColor: colors.accent,
      borderRadius: 14,
      padding: 18,
      alignItems: 'center',
    },
    guideBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },

    // Nail Placement Guide styles
    nailGuideContainer: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    nailGuideHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 16,
    },
    nailGuideIcon: { fontSize: 18 },
    nailGuideTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
    nailGuideChevron: { color: colors.subtext, fontSize: 14 },
    nailGuideBody: {
      paddingHorizontal: 16,
      paddingBottom: 16,
      gap: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 14,
    },
    nailGuideSubtitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
      textAlign: 'center',
      marginBottom: 2,
    },
    nailGuideDistance: {
      color: colors.accent,
      fontSize: 14,
      fontWeight: '600',
      textAlign: 'center',
      marginBottom: 8,
    },
    nailGuideHint: {
      color: colors.subtextMuted,
      fontSize: 12,
      textAlign: 'center',
      marginBottom: 4,
    },
    nailGuideRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceAlt,
      borderRadius: 10,
      padding: 12,
      gap: 10,
    },
    nailGuideLabelBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flex: 1,
    },
    nailGuideEmoji: { fontSize: 16 },
    nailGuideSideLabel: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    nailGuideCountBox: {
      alignItems: 'center',
      minWidth: 50,
    },
    nailGuideCount: {
      color: colors.accent,
      fontSize: 20,
      fontWeight: '800',
    },
    nailGuideCountLabel: {
      color: colors.subtextMuted,
      fontSize: 10,
      textTransform: 'uppercase',
    },
    nailGuideRangeBox: {
      backgroundColor: colors.accentMuted,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
      minWidth: 80,
      alignItems: 'center',
    },
    nailGuideRange: {
      color: colors.accentText,
      fontSize: 12,
      fontWeight: '700',
    },
    nailGuideTip: {
      backgroundColor: colors.accentMuted,
      borderRadius: 10,
      padding: 12,
      marginTop: 4,
    },
    nailGuideTipText: {
      color: colors.accentText,
      fontSize: 12,
      lineHeight: 18,
    },
  });
}
