export const tabSlide = (direction) => ({
  initial: { opacity: 0, x: direction > 0 ? 60 : -60 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] } },
  exit: { opacity: 0, x: direction > 0 ? -60 : 60, transition: { duration: 0.2 } },
})
