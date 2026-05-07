import { ref, onMounted } from 'vue'
import { supabase } from '../services/supabase'
import type { User } from '@supabase/supabase-js'

export function useAuth() {
  const user = ref<User | null>(null)
  const loading = ref(true)

  const checkUser = async () => {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      user.value = currentUser
    } catch (e) {
      console.error('Auth error:', e)
    } finally {
      loading.value = false
    }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    user.value = null
  }

  onMounted(() => {
    checkUser()
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      user.value = session?.user ?? null
    })

    return () => subscription.unsubscribe()
  })

  return {
    user,
    loading,
    signOut
  }
}
