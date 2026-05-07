import { ref } from 'vue'
import { supabase, type CloudDocument } from '../services/supabase'

export function useCloudStorage() {
  const documents = ref<CloudDocument[]>([])
  const loading = ref(false)

  const listDocuments = async () => {
    loading.value = true
    try {
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .order('updated_at', { ascending: false })

      if (error) throw error
      documents.value = data as CloudDocument[]
    } catch (e) {
      console.error('Failed to list cloud documents:', e)
    } finally {
      loading.value = false
    }
  }

  const saveDocument = async (name: string, data: Uint8Array) => {
    try {
      // Tenta pegar o usuário, mas não bloqueia se não houver
      const { data: { user } } = await supabase.auth.getUser()
      const ownerId = user?.id || 'anonymous'
      const folder = user?.id || 'public'
      const filename = `${folder}/${Date.now()}.fig`
      
      // 1. Upload binary to storage
      const { error: uploadError } = await supabase.storage
        .from('pencil-files')
        .upload(filename, data, {
          contentType: 'application/octet-stream',
          upsert: true
        })

      if (uploadError) throw uploadError

      // 2. Save metadata to DB
      const { data: doc, error: dbError } = await supabase
        .from('documents')
        .upsert({
          name,
          owner_id: ownerId === 'anonymous' ? null : ownerId,
          data_path: filename,
          updated_at: new Date().toISOString()
        })
        .select()
        .single()

      if (dbError) throw dbError
      return doc as CloudDocument
    } catch (e) {
      console.error('Failed to save cloud document:', e)
      throw e
    }
  }


  const loadDocument = async (doc: CloudDocument) => {
    try {
      const { data, error } = await supabase.storage
        .from('pencil-files')
        .download(doc.data_path)

      if (error) throw error
      return new Uint8Array(await data.arrayBuffer())
    } catch (e) {
      console.error('Failed to load cloud document:', e)
      throw e
    }
  }

  const updateDocument = async (id: string, data: Uint8Array) => {
    try {
      const { data: doc, error: fetchError } = await supabase
        .from('documents')
        .select('data_path')
        .eq('id', id)
        .single()

      if (fetchError || !doc) throw fetchError || new Error('Document not found')

      const { error: uploadError } = await supabase.storage
        .from('pencil-files')
        .upload(doc.data_path, data, { 
          contentType: 'application/octet-stream',
          upsert: true 
        })

      if (uploadError) throw uploadError

      await supabase
        .from('documents')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', id)
    } catch (e) {
      console.error('Failed to update cloud document:', e)
      throw e
    }
  }

  return {
    documents,
    loading,
    listDocuments,
    saveDocument,
    loadDocument,
    updateDocument
  }
}

