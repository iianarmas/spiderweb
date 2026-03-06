import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  ActivityIndicator,
  Image,
  ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../../src/lib/supabase';
import { useProjectStore, Project } from '../../../../src/store/projectStore';

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { activeProject, setActiveProject } = useProjectStore();
  const [project, setProject] = useState<Project | null>(activeProject);
  const [loading, setLoading] = useState(!activeProject);

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

  if (loading || !project) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#7c4dff" />
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
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>← Back</Text>
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
          <InfoCell label="Shape" value={project.frameShape} />
          <InfoCell label="Mode" value={project.mode === 'bw' ? 'B&W' : 'Color'} />
          <InfoCell label="Nails" value={String(project.nailCount)} />
          <InfoCell label="Strings" value={String(project.stringCount)} />
        </View>

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
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoCell}>
      <Text style={styles.infoCellLabel}>{label}</Text>
      <Text style={styles.infoCellValue}>{value}</Text>
    </View>
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
  headerTitle: { color: '#e0c9ff', fontSize: 18, fontWeight: '700', flex: 1, textAlign: 'center' },
  deleteBtn: { color: '#ff6b6b', fontSize: 14, width: 60, textAlign: 'right' },
  content: { padding: 20, gap: 20 },
  image: { width: '100%', aspectRatio: 1, borderRadius: 16 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  infoCell: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#2a2a4a',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#3a3a5a',
  },
  infoCellLabel: { color: '#9b8ab8', fontSize: 12, marginBottom: 4 },
  infoCellValue: { color: '#e0c9ff', fontSize: 18, fontWeight: '700' },
  progressSection: { gap: 8 },
  progressTitle: { color: '#e0c9ff', fontSize: 16, fontWeight: '700' },
  progressBar: { height: 10, backgroundColor: '#2a2a4a', borderRadius: 5, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#7c4dff', borderRadius: 5 },
  progressLabel: { color: '#9b8ab8', fontSize: 13 },
  guideBtn: {
    backgroundColor: '#7c4dff',
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
  },
  guideBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
