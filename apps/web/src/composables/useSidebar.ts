import { computed, inject, onMounted, onUnmounted, provide, ref, type InjectionKey, type Ref } from 'vue';

type SidebarContext = {
  isExpanded: Ref<boolean>;
  isMobileOpen: Ref<boolean>;
  isHovered: Ref<boolean>;
  toggleSidebar: () => void;
  toggleMobileSidebar: () => void;
  setIsHovered: (value: boolean) => void;
};

const key: InjectionKey<SidebarContext> = Symbol('sidebar');

export function useSidebarProvider() {
  const isExpanded = ref(true);
  const isMobileOpen = ref(false);
  const isMobile = ref(false);
  const isHovered = ref(false);

  const handleResize = () => {
    isMobile.value = window.innerWidth < 1024;
    if (!isMobile.value) isMobileOpen.value = false;
  };

  onMounted(() => {
    handleResize();
    window.addEventListener('resize', handleResize);
  });
  onUnmounted(() => window.removeEventListener('resize', handleResize));

  const context: SidebarContext = {
    isExpanded: computed(() => (isMobile.value ? false : isExpanded.value)) as Ref<boolean>,
    isMobileOpen,
    isHovered,
    toggleSidebar() {
      if (isMobile.value) isMobileOpen.value = !isMobileOpen.value;
      else isExpanded.value = !isExpanded.value;
    },
    toggleMobileSidebar() {
      isMobileOpen.value = !isMobileOpen.value;
    },
    setIsHovered(value: boolean) {
      isHovered.value = value;
    }
  };
  provide(key, context);
  return context;
}

export function useSidebar() {
  const context = inject(key);
  if (!context) throw new Error('useSidebar must be used inside AdminLayout');
  return context;
}
