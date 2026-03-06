import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { useProjectStore, Project } from '../../src/store/projectStore';

export default function HomeScreen() {
  const router = useRouter();
  const { projects, setProjects, setActiveProject } = useProjectStore();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchProjects = useCallback(async () => {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setProjects(
        (data ?? []).map((row: any) => ({
          id: row.id,
          title: row.title,
          mode: row.mode,
          frameShape: row.frame_shape,
          nailCount: row.nail_count,
          stringCount: row.string_count,
          frameDimensions: row.frame_dimensions,
          nailSequence: row.nail_sequence,
          colorLayers: row.color_layers,
          originalImageUri: row.original_image_url,
          previewImageUrl: row.preview_image_url,
          currentStep: row.current_step ?? 0,
          currentColorLayer: row.current_color_layer ?? 0,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
      );
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    fetchProjects();
  }, []);

  function handleOpenProject(project: Project) {
    setActiveProject(project);
    router.push(`/(app)/project/${project.id}`);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  function progressLabel(project: Project): string {
    const total = project.nailSequence?.length ?? 0;
    const step = project.currentStep ?? 0;
    if (total === 0) return 'Not started';
    if (step >= total - 1) return 'Completed';
    return `${step} / ${total - 1} strings`;
  }

  function progressPercent(project: Project): number {
    const total = (project.nailSequence?.length ?? 1) - 1;
    if (total <= 0) return 0;
    return Math.min(100, Math.round(((project.currentStep ?? 0) / total) * 100));
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#7c4dff" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>🕸 Spiderweb</Text>
        <TouchableOpacity onPress={handleSignOut}>
          <Text style={styles.signOut}>Sign out</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={projects}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchProjects(); }}
            tintColor="#7c4dff"
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No projects yet.</Text>
            <Text style={styles.emptySubtext}>Tap + to start your first thread art.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const pct = progressPercent(item);
          return (
            <TouchableOpacity style={styles.card} onPress={() => handleOpenProject(item)}>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardBadge}>{item.mode === 'bw' ? 'B&W' : 'Color'}</Text>
              </View>
              <Text style={styles.cardMeta}>
                {item.frameShape} · {item.nailCount} nails · {item.stringCount} strings
              </Text>
              <View style={styles.progressRow}>
                <View style={styles.progressBar}>
                  <View style={[styles.progressFill, { width: `${pct}%` }]} />
                </View>
                <Text style={styles.progressLabel}>{progressLabel(item)}</Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/(app)/project/new')}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
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
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: { fontSize: 24, fontWeight: '800', color: '#e0c9ff' },
  signOut: { color: '#9b8ab8', fontSize: 14 },
  list: { padding: 16, paddingBottom: 100 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyText: { color: '#e0c9ff', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptySubtext: { color: '#9b8ab8', fontSize: 14 },
  card: {
    backgroundColor: '#2a2a4a',
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#3a3a5a',
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardTitle: { color: '#e0c9ff', fontSize: 17, fontWeight: '700', flex: 1 },
  cardBadge: {
    backgroundColor: '#3d2b6b',
    color: '#b89eff',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  cardMeta: { color: '#9b8ab8', fontSize: 13, marginBottom: 10 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressBar: {
    flex: 1,
    height: 6,
    backgroundColor: '#3a3a5a',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: '#7c4dff', borderRadius: 3 },
  progressLabel: { color: '#9b8ab8', fontSize: 12, width: 90, textAlign: 'right' },
  fab: {
    position: 'absolute',
    right: 24,
    bottom: 32,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#7c4dff',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
  },
  fabText: { color: '#fff', fontSize: 32, lineHeight: 36, fontWeight: '300' },
});
