import React, { useState, useEffect, useRef } from 'react';
import { Compass, CheckCircle, Circle, Mail as Sail, Mountain, BookOpen, Palette, GripVertical, X } from 'lucide-react';
import { ControlPanel } from './ControlPanel';
import { SailingSummaryPanel } from './SailingSummaryPanel';
import { PermissionPanel } from './PermissionPanel';
import { VideoPreview } from './VideoPreview';
import { SeagullPanel } from './SeagullPanel';
import { DriftNotification } from './DriftNotification';
import { auth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { usePassiveListening } from '../hooks/usePassiveListening';

interface Task {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  priority: number;
  status: 'pending' | 'in_progress' | 'completed' | 'archived';
  created_at: string;
  updated_at: string;
  source_thought_id?: string;
}

interface SailingSummaryData {
  imageUrl: string;
  summaryText: string;
}

interface JourneyPanelProps {
  isVisible: boolean;
  onClose?: () => void;
}

const getCategoryIcon = (priority: number) => {
  // Map priority to category icons
  switch (priority) {
    case 1:
      return <Mountain className="w-4 h-4" />; // High priority
    case 2:
      return <BookOpen className="w-4 h-4" />; // Medium priority
    case 3:
      return <Palette className="w-4 h-4" />; // Low priority
    default:
      return <Circle className="w-4 h-4" />;
  }
};

const getPriorityColor = (priority: number) => {
  switch (priority) {
    case 1:
      return 'text-red-400'; // High priority - red
    case 2:
      return 'text-yellow-400'; // Medium priority - yellow
    case 3:
      return 'text-green-400'; // Low priority - green
    default:
      return 'text-white/60';
  }
};

const getPriorityText = (priority: number) => {
  switch (priority) {
    case 1:
      return 'High Priority';
    case 2:
      return 'Medium Priority';
    case 3:
      return 'Low Priority';
    default:
      return 'Unknown Priority';
  }
};

export const JourneyPanel: React.FC<JourneyPanelProps> = ({
  isVisible,
  onClose
}) => {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showControlPanel, setShowControlPanel] = useState(false);
  const [showSummaryPanel, setShowSummaryPanel] = useState(false);
  const [summaryData, setSummaryData] = useState<SailingSummaryData | undefined>(undefined);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [showPermissionPanel, setShowPermissionPanel] = useState(false);
  const [showSeagullPanel, setShowSeagullPanel] = useState(false);
  const [seagullMessage, setSeagullMessage] = useState<string>('');
  const [seagullConversationContext, setSeagullConversationContext] = useState<any>(null);

  // Sailing session state
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [sessionStartTime, setSessionStartTime] = useState<Date | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [hasPermissions, setHasPermissions] = useState(false);
  // Reuse screen stream from PermissionPanel without re-prompt
  // No need for extra boolean – presence of screenStream indicates status
  const [isStartingSession, setIsStartingSession] = useState(false);

  // Realtime channel reference
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Media state management
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);

  // Media stream references
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);

  // Refs to avoid stale closures in heartbeat callbacks
  const videoStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  // Refs for video elements
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const screenRef = useRef<HTMLVideoElement | null>(null);

  // Heartbeat system for distraction detection
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [isHeartbeatActive, setIsHeartbeatActive] = useState(false);

  // Passive listening hook (FR-2.2)
  const {
    isPassiveListening,
    isSpeechDetected,
    passiveTranscript,
    startPassiveListening,
    stopPassiveListening
  } = usePassiveListening({
    currentSessionId,
    isSessionActive
  });

  // Drag and drop state
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Drift detection state
  const [isDrifting, setIsDrifting] = useState(false);
  const [driftReason, setDriftReason] = useState('');
  const [isDriftAcknowledged, setIsDriftAcknowledged] = useState(false);

  // Fetch tasks from database
  const fetchTasks = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const currentUser = auth.getCurrentUser();
      if (!currentUser) {
        throw new Error('User not authenticated');
      }

      console.log('🔄 Fetching tasks for user:', currentUser.id);

      const { data: tasksData, error: tasksError } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('priority', { ascending: true })
        .order('created_at', { ascending: false });

      if (tasksError) {
        throw tasksError;
      }

      console.log('✅ Tasks fetched:', tasksData);

      // Transform database tasks to match our interface
      const transformedTasks: Task[] = tasksData.map(task => ({
        id: task.id,
        title: task.title,
        description: task.description || '',
        completed: task.status === 'completed',
        priority: task.priority,
        status: task.status,
        created_at: task.created_at,
        updated_at: task.updated_at,
        source_thought_id: task.source_thought_id
      }));

      setTasks(transformedTasks);

      // Select the first task if available
      if (transformedTasks.length > 0) {
        setSelectedTask(transformedTasks[0]);
      }

    } catch (error) {
      console.error('❌ Error fetching tasks:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch tasks when component becomes visible
  useEffect(() => {
    if (isVisible) {
      fetchTasks();
      // Check permissions when panel opens
      checkInitialPermissions();
    }
  }, [isVisible]);

  // Check initial permissions when panel opens
  const checkInitialPermissions = async () => {
    try {
      let hasMic = false;
      let hasCamera = false;
      let hasScreen = false;

      // Check microphone permission
      try {
        const micPermission = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        hasMic = micPermission.state === 'granted';
      } catch (error) {
        console.warn('Could not check microphone permission:', error);
        hasMic = false;
      }

      // Check camera permission
      try {
        const cameraPermission = await navigator.permissions.query({ name: 'camera' as PermissionName });
        hasCamera = cameraPermission.state === 'granted';
      } catch (error) {
        console.warn('Could not check camera permission:', error);
        hasCamera = false;
      }

      // Screen sharing can't be queried, assume false initially
      hasScreen = false;

      // Only set hasPermissions to true if we have microphone (required)
      // The permission panel will handle checking all three
      setHasPermissions(hasMic);

      console.log('Initial permissions check:', { hasMic, hasCamera, hasScreen });
    } catch (error) {
      console.warn('Could not check initial permissions:', error);
      setHasPermissions(false);
    }
  };

  // Cleanup Realtime channel, media streams, and heartbeat on component unmount
  useEffect(() => {
    return () => {
      cleanupRealtimeChannel();
      cleanupMediaStreams();
      stopHeartbeat();
    };
  }, []);

  const toggleTaskCompletion = async (taskId: string) => {
    try {
      const task = tasks.find(t => t.id === taskId);
      if (!task) return;

      const newStatus = task.completed ? 'pending' : 'completed';

      const { error } = await supabase
        .from('tasks')
        .update({
          status: newStatus,
          completed_at: newStatus === 'completed' ? new Date().toISOString() : null
        })
        .eq('id', taskId);

      if (error) {
        throw error;
      }

      // Update local state
      setTasks(prev => prev.map(t =>
        t.id === taskId
          ? { ...t, completed: !t.completed, status: newStatus }
          : t
      ));

      console.log('✅ Task status updated:', taskId, newStatus);
    } catch (error) {
      console.error('❌ Error updating task:', error);
    }
  };

  // Delete task handler
  const deleteTask = async (taskId: string) => {
    try {
      const { error } = await supabase
        .from('tasks')
        .delete()
        .eq('id', taskId);

      if (error) {
        console.error('Error deleting task:', error);
        return;
      }

      // Update local state
      const updatedTasks = tasks.filter(task => task.id !== taskId);
      setTasks(updatedTasks);

      // If deleted task was selected, select the first remaining task
      if (selectedTask?.id === taskId) {
        setSelectedTask(updatedTasks.length > 0 ? updatedTasks[0] : null);
      }

      console.log('✅ Task deleted:', taskId);
    } catch (error) {
      console.error('❌ Error deleting task:', error);
    }
  };

  // Drag and drop handlers
  const handleDragStart = (task: Task) => {
    setDraggedTask(task);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();

    if (!draggedTask) return;

    const dragIndex = tasks.findIndex(t => t.id === draggedTask.id);
    if (dragIndex === dropIndex) return;

    // Reorder tasks
    const newTasks = [...tasks];
    const [draggedItem] = newTasks.splice(dragIndex, 1);
    newTasks.splice(dropIndex, 0, draggedItem);

    setTasks(newTasks);
    setDraggedTask(null);
    setDragOverIndex(null);

    console.log('✅ Task reordered:', draggedTask.title, 'to index', dropIndex);
  };

  const handleDragEnd = () => {
    setDraggedTask(null);
    setDragOverIndex(null);
  };

  // Handle permission panel completion
  const handlePermissionsGranted = (
    hasEssentialPermissions: boolean,
    incomingScreenStream?: MediaStream
  ) => {
    setHasPermissions(hasEssentialPermissions);

    // If we receive a screen stream from the permission panel, reuse it immediately
    if (incomingScreenStream && !screenStream) {
      console.log('🖥️ Reusing screen stream from permission panel');
      setScreenStream(incomingScreenStream);
      screenStreamRef.current = incomingScreenStream;
      setIsScreenSharing(true);
      if (screenRef.current) {
        screenRef.current.srcObject = incomingScreenStream;
      }
    }

    if (hasEssentialPermissions) {
      setSessionError(null);
      // Don't auto-start here - let the permission panel handle it via onClose
    }
  };

  // Media handling functions
  const toggleVideo = async () => {
    try {
      if (isVideoOn && videoStream) {
        // Turn off video
        videoStream.getTracks().forEach(track => track.stop());
        setVideoStream(null);
        videoStreamRef.current = null;
        setIsVideoOn(false);
        if (videoRef.current) {
          videoRef.current.srcObject = null;
        }
        console.log('Video turned off');
        return;
      }

      // Guard against duplicate requests
      if (videoStream && videoStream.active) {
        console.log('Camera already active, skipping initialization');
        return;
      }

      console.log('🎥 Attempting to start camera...');
      
      // First, try to clean up any existing video tracks globally
      try {
        const existingTracks = [];
        if (videoStream) {
          existingTracks.push(...videoStream.getVideoTracks());
        }
        existingTracks.forEach(track => {
          console.log('🔄 Stopping existing video track:', track.label);
          track.stop();
        });
        
        // Small delay to allow hardware cleanup
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (cleanupError) {
        console.warn('Warning during video cleanup:', cleanupError);
      }
      
      // Try different constraint sets with fallbacks
      const constraintSets = [
        // Primary: High quality
        {
          video: {
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            frameRate: { ideal: 30, max: 60 }
          }
        },
        // Fallback 1: Medium quality
        {
          video: {
            width: { ideal: 640, max: 1280 },
            height: { ideal: 480, max: 720 },
            frameRate: { ideal: 15, max: 30 }
          }
        },
        // Fallback 2: Basic quality
        {
          video: {
            width: { ideal: 320, max: 640 },
            height: { ideal: 240, max: 480 }
          }
        },
        // Fallback 3: Minimal constraints
        {
          video: true
        }
      ];

      let stream = null;
      let lastError = null;

            for (let i = 0; i < constraintSets.length; i++) {
        try {
          console.log(`🎥 Trying camera constraints set ${i + 1}/${constraintSets.length}...`);
          
          // Add a small delay between attempts to allow hardware reset
          if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
          
          stream = await navigator.mediaDevices.getUserMedia(constraintSets[i]);
          console.log(`✅ Camera started successfully with constraint set ${i + 1}`);
          
          // Log camera details for debugging
          const videoTrack = stream.getVideoTracks()[0];
          if (videoTrack) {
            const settings = videoTrack.getSettings();
            console.log(`📹 Camera details: ${videoTrack.label}, ${settings.width}x${settings.height}@${settings.frameRate}fps`);
          }
          
          break;
        } catch (error) {
          const err = error as Error;
          lastError = err;
          console.warn(`❌ Constraint set ${i + 1} failed:`, err.message);
          console.warn(`❌ Error type: ${err.name}, Error code:`, (err as any).constraint);
          
          // If this is a permission error, don't try other constraints
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            throw err;
          }
          
          // For NotReadableError, try to diagnose the issue
          if (err.name === 'NotReadableError') {
            console.warn('🔍 Camera may be in use by another application or locked by the OS');
            console.warn('🔍 Try closing other applications that might use the camera');
          }
        }
      }

      if (!stream) {
        throw lastError || new Error('Failed to start camera with all constraint sets');
      }

      // Verify stream is actually working
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack || videoTrack.readyState !== 'live') {
        stream.getTracks().forEach(track => track.stop());
        throw new Error('Camera stream is not live');
      }

      setVideoStream(stream);
      videoStreamRef.current = stream;
      setIsVideoOn(true);
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      console.log('✅ Camera turned on successfully');
      
    } catch (error) {
      const err = error as Error;
      console.error('❌ Error toggling video:', err);
      
      // Provide specific error messages based on error type
      let errorMessage = 'Failed to access camera. ';
      
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMessage += 'Please allow camera access in your browser settings.';
      } else if (err.name === 'NotFoundError') {
        errorMessage += 'No camera found on this device.';
      } else if (err.name === 'NotReadableError') {
        errorMessage += 'Camera is unavailable. This usually means:\n';
        errorMessage += '• Another application is using the camera (close other video apps)\n';
        errorMessage += '• Camera hardware issue (try restarting your browser)\n';
        errorMessage += '• OS-level camera restrictions\n';
        errorMessage += 'The session will continue without camera monitoring.';
      } else if (err.name === 'OverconstrainedError') {
        errorMessage += 'Camera does not support the required settings.';
      } else {
        errorMessage += `Please check your camera settings. Error: ${err.message}`;
      }
      
      setSessionError(errorMessage);
      
      // Reset video state on error
      setIsVideoOn(false);
      setVideoStream(null);
      videoStreamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    }
  };

  const toggleScreenShare = async () => {
    try {
      if (isScreenSharing && screenStream) {
        // Stop screen sharing
        screenStream.getTracks().forEach(track => track.stop());
        setScreenStream(null);
        screenStreamRef.current = null;
        setIsScreenSharing(false);
        if (screenRef.current) {
          screenRef.current.srcObject = null;
        }
        console.log('Screen sharing stopped');
      } else {
        // Start screen sharing
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        });
        setScreenStream(stream);
        screenStreamRef.current = stream;
        setIsScreenSharing(true);
        if (screenRef.current) {
          screenRef.current.srcObject = stream;
        }

        // Handle when user stops sharing via browser UI
        stream.getVideoTracks()[0].addEventListener('ended', () => {
          setScreenStream(null);
          screenStreamRef.current = null;
          setIsScreenSharing(false);
          if (screenRef.current) {
            screenRef.current.srcObject = null;
          }
        });

        console.log('Screen sharing started');
      }
    } catch (error) {
      console.error('Error toggling screen share:', error);
      setSessionError('Failed to start screen sharing. Please check permissions.');
    }
  };

  const toggleMic = async () => {
    try {
      if (!micStream) {
        // Request microphone access if not already available
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setMicStream(stream);
        setIsMicMuted(false);
        console.log('Microphone access granted');
      } else {
        // Toggle mute state
        const audioTrack = micStream.getAudioTracks()[0];
        if (audioTrack) {
          audioTrack.enabled = isMicMuted;
          setIsMicMuted(!isMicMuted);
          console.log('Microphone', isMicMuted ? 'unmuted' : 'muted');
        }
      }
    } catch (error) {
      console.error('Error toggling microphone:', error);
      setSessionError('Failed to access microphone. Please check permissions.');
    }
  };

  // Cleanup all media streams
  const cleanupMediaStreams = () => {
    if (videoStream) {
      videoStream.getTracks().forEach(track => track.stop());
      setVideoStream(null);
      videoStreamRef.current = null;
      setIsVideoOn(false);
    }
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      setScreenStream(null);
      screenStreamRef.current = null;
      setIsScreenSharing(false);
    }
    if (micStream) {
      micStream.getTracks().forEach(track => track.stop());
      setMicStream(null);
      setIsMicMuted(false);
    }

    // Stop passive listening
    stopPassiveListening();

    // Reset screen sharing permission tracking
    // setScreenSharingGrantedInPermissionPanel(false); // No longer needed

    console.log('All media streams cleaned up');
  };

  // FR-2.2: Passive Listening now handled by usePassiveListening hook

  // Image capture utilities for heartbeat system
  const captureCameraFrame = async (): Promise<Blob | null> => {
    const stream = videoStreamRef.current;
    if (!stream) {
      console.warn('No video stream available for camera capture');
      return null;
    }

    try {
      console.log('🎥 DEBUG: Starting camera capture...');
      const tracks = stream.getVideoTracks();
      console.log('🎥 DEBUG: Video tracks:', tracks.length, tracks[0]?.readyState);

      const canvas = document.createElement('canvas');
      const video = document.createElement('video');

      // Set up video element
      video.srcObject = stream;
      video.muted = true;
      video.setAttribute('playsinline', 'true');

      // Log any immediate errors on the <video> element
      video.addEventListener('error', (ev) => {
        console.error('🎥 DEBUG: <video> element error', ev);
      });

      // Attempt to play the video – catch promise rejection explicitly
      try {
        await video.play();
        console.log('🎥 DEBUG: video.play() resolved');
      } catch (playErr) {
        console.error('❌ DEBUG: video.play() rejected', playErr);
        throw playErr;
      }

      // Wait for first frame to be ready (loadedmetadata)
      let metadataResolved = false;
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!metadataResolved) {
            console.warn('⏱️ DEBUG: loadedmetadata timeout (1s) – dimensions:', video.videoWidth, 'x', video.videoHeight);
            resolve(null);
          }
        }, 1000);
        video.onloadedmetadata = () => {
          metadataResolved = true;
          clearTimeout(timeout);
          resolve(null);
        };
      });

      // Wait for first frame to be ready
      console.log('🎥 DEBUG: Video dimensions after metadata/timeout:', video.videoWidth, 'x', video.videoHeight);

      // Compress to reasonable size (640x360) to reduce payload
      const targetWidth = 640;
      const targetHeight = 360;
      const sourceWidth = video.videoWidth || 640;
      const sourceHeight = video.videoHeight || 480;

      // Calculate aspect ratio preserving dimensions
      const aspectRatio = sourceWidth / sourceHeight;
      let finalWidth = targetWidth;
      let finalHeight = targetHeight;

      if (aspectRatio > (targetWidth / targetHeight)) {
        finalHeight = targetWidth / aspectRatio;
      } else {
        finalWidth = targetHeight * aspectRatio;
      }

      canvas.width = finalWidth;
      canvas.height = finalHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Could not get canvas context');
      }

      // Draw video frame to canvas with compression
      ctx.drawImage(video, 0, 0, finalWidth, finalHeight);

      // Convert to blob with higher compression (0.85 quality)
      return new Promise((resolve) => {
        canvas.toBlob((blob) => {
          console.log('🎥 DEBUG: Camera blob created:', blob ? `${(blob.size / 1024).toFixed(1)}KB` : 'NULL');
          resolve(blob);
        }, 'image/jpeg', 0.85);
      });
    } catch (error) {
      console.error('❌ Error capturing camera frame:', error);
      return null;
    }
  };

  const captureScreenFrame = async (): Promise<Blob | null> => {
    const stream = screenStreamRef.current;
    if (!stream) {
      console.warn('No screen stream available for screen capture');
      return null;
    }

    try {
      console.log('🖥️ DEBUG: Starting screen capture...');
      const tracks = stream.getVideoTracks();
      console.log('🖥️ DEBUG: Screen tracks:', tracks.length, tracks[0]?.readyState);

      const canvas = document.createElement('canvas');
      const video = document.createElement('video');

      // Set up video element
      video.srcObject = stream;
      video.muted = true;
      await video.play();

      // Wait for metadata (dimensions) – if the event fired before we attached the
      // handler, or it never comes, fall back after 1s so the Promise resolves
      await new Promise((resolve) => {
        if (video.readyState >= 1) { // HAVE_METADATA already available
          resolve(null)
          return
        }
        const timeout = setTimeout(() => {
          console.warn('⏱️ DEBUG: loadedmetadata timeout (1s) – dimensions:', video.videoWidth, 'x', video.videoHeight)
          resolve(null)
        }, 1000)
        video.onloadedmetadata = () => {
          clearTimeout(timeout)
          resolve(null)
        }
      })
      console.log('🖥️ DEBUG: Screen dimensions:', video.videoWidth, 'x', video.videoHeight);

      // Compress screen capture to reasonable size (960x540) to reduce payload
      const targetWidth = 1008;
      const targetHeight = 567;
      const sourceWidth = video.videoWidth || 1280;
      const sourceHeight = video.videoHeight || 720;

      // Calculate aspect ratio preserving dimensions
      const aspectRatio = sourceWidth / sourceHeight;
      let finalWidth = targetWidth;
      let finalHeight = targetHeight;

      if (aspectRatio > (targetWidth / targetHeight)) {
        finalHeight = targetWidth / aspectRatio;
      } else {
        finalWidth = targetHeight * aspectRatio;
      }

      canvas.width = finalWidth;
      canvas.height = finalHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Could not get canvas context');
      }

      // Draw video frame to canvas with compression
      ctx.drawImage(video, 0, 0, finalWidth, finalHeight);

      // Convert to blob with higher compression (0.85 quality)
      return new Promise((resolve) => {
        canvas.toBlob((blob) => {
          console.log('🖥️ DEBUG: Screen blob created:', blob ? `${(blob.size / 1024).toFixed(1)}KB` : 'NULL');
          resolve(blob);
        }, 'image/jpeg', 0.85);
      });
    } catch (error) {
      console.error('❌ Error capturing screen frame:', error);
      return null;
    }
  };

  // Heartbeat function - sends periodic focus check to backend
  // Helper function to convert blob to base64
  function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }

  const sendHeartbeat = async (sessionId: string, isActive: boolean) => {
    if (!sessionId || !isActive) {
      console.log('Invalid session parameters for heartbeat:', { sessionId, isActive });
      return;
    }

    console.log('📊 Sending heartbeat for session:', sessionId);

    try {
      // Capture images from active streams
      console.log('📸 DEBUG: Starting capture process...');
      const [cameraBlob, screenBlob] = await Promise.all([
        captureCameraFrame(),
        captureScreenFrame()
      ]);

      console.log('📸 DEBUG: Capture results:', {
        camera: cameraBlob ? `${(cameraBlob.size / 1024).toFixed(1)}KB` : 'NULL',
        screen: screenBlob ? `${(screenBlob.size / 1024).toFixed(1)}KB` : 'NULL'
      });

      // Skip heartbeat if no images captured
      if (!cameraBlob && !screenBlob) {
        console.warn('⚠️ Heartbeat skipped: No media to send.')
        return;
      }

      // Convert blobs to base64 strings
      const cameraImageBase64 = cameraBlob ? await blobToBase64(cameraBlob) : null
      const screenImageBase64 = screenBlob ? await blobToBase64(screenBlob) : null

      console.log('📸 DEBUG: Base64 conversion:', {
        camera: cameraImageBase64 ? `${cameraImageBase64.slice(0, 50)}...` : 'NULL',
        screen: screenImageBase64 ? `${screenImageBase64.slice(0, 50)}...` : 'NULL'
      });

      // Invoke the backend function with the new payload
      const { data, error } = await supabase.functions.invoke('session-heartbeat', {
        body: {
          sessionId: sessionId,
          cameraImage: cameraImageBase64,
          screenImage: screenImageBase64
        },
      });

      if (error) {
        console.error('❌ Heartbeat failed:', error);
        return;
      }

      console.log('✅ Heartbeat sent successfully:', data);

      // Handle drift state changes
      const newDriftState = data.is_drifting;
      
      // Only allow transitions TO drift state automatically
      // Transitions OUT of drift state require manual "Continue Working" action
      if (newDriftState && !isDrifting) {
        console.log(`🔄 Drift detected: ${isDrifting} → ${newDriftState}`);
        setIsDrifting(true);
        setDriftReason(data.drift_reason || 'Focus has drifted from the task');
        setIsDriftAcknowledged(false); // Reset acknowledgment when new drift is detected
        
        // Trigger Spline scene change to drift mode
        triggerSplineDriftScene(true);
      } else if (!newDriftState && isDrifting) {
        // AI thinks user is focused but we're in drift mode
        // Don't automatically exit drift mode - require manual action
        console.log('🔒 AI detects focus but staying in drift mode until manual exit');
      }

      // Log drift status for debugging
      if (data.is_drifting) {
        console.warn('🚨 Drift detected:', data.drift_reason);
      } else {
        console.log('✨ User focused:', data.actual_task);
      }
    } catch (error) {
      console.error('❌ Error sending heartbeat:', error);
    }
  };

  // Start heartbeat monitoring
  const startHeartbeat = (sessionId: string, isActive: boolean) => {
    if (heartbeatIntervalRef.current) {
      console.log('Heartbeat already active');
      return;
    }

    console.log('🔄 Starting heartbeat monitoring (60s intervals) for session:', sessionId);
    setIsHeartbeatActive(true);

    // Send first heartbeat after longer delay to ensure streams are ready
    setTimeout(() => sendHeartbeat(sessionId, isActive), 8000); // Wait 8 seconds for streams to stabilize

    // Then send every 60 seconds
    heartbeatIntervalRef.current = setInterval(() => sendHeartbeat(sessionId, isActive), 60000);
  };

  // Stop heartbeat monitoring
  const stopHeartbeat = () => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
      setIsHeartbeatActive(false);
      console.log('⏹️ Heartbeat monitoring stopped');
    }
  };

  // Setup Realtime channel for session
  const setupRealtimeChannel = (sessionId: string) => {
    if (realtimeChannelRef.current) {
      supabase.removeChannel(realtimeChannelRef.current);
    }

    const channel = supabase.channel(`session:${sessionId}`);

    channel
      .on('broadcast', { event: 'session_event' }, (payload) => {
        console.log('Session event received:', payload);
        // Handle session events like drift detection, AI interventions, etc.
      })
      .on('broadcast', { event: 'session_ended' }, (payload) => {
        console.log('Session ended remotely:', payload);
        setIsSessionActive(false);
        setCurrentSessionId(null);
      })
      .on('broadcast', { event: 'deep_drift_detected' }, (payload) => {
        console.log('🚨 Deep drift detected, triggering AI intervention:', payload);

        // Trigger SeagullPanel with intervention message and conversation context
        const interventionMessage = payload.payload?.message ||
          `Captain, I've noticed you've been drifting for ${payload.payload?.consecutive_drifts || 5} minutes. Let's get back on course together.`;

        // Store conversation context for continuous conversation
        const currentUser = auth.getCurrentUser();
        const conversationContext = {
          type: 'drift_intervention',
          sessionId: currentSessionId,
          consecutiveDrifts: payload.payload?.consecutive_drifts,
          conversationId: payload.payload?.conversation_id,
          messageId: payload.payload?.message_id,
          userId: currentUser?.id,
          isDriftIntervention: true
        };

        setSeagullMessage(interventionMessage);
        setSeagullConversationContext(conversationContext);
        setShowSeagullPanel(true);

        // Play TTS audio if available (FR-2.4)
        if (payload.payload?.audio_url && payload.payload?.tts_success) {
          try {
            const audio = new Audio(payload.payload.audio_url);
            audio.play();
            console.log('🔊 Playing drift intervention TTS audio');
          } catch (audioError) {
            console.error('Error playing drift intervention audio:', audioError);
          }
        }

        console.log('🦅 Seagull drift intervention activated with continuous conversation enabled');
      })
      .subscribe((status) => {
        console.log('Realtime channel status:', status);
      });

    realtimeChannelRef.current = channel;
  };

  // Clean up Realtime channel
  const cleanupRealtimeChannel = () => {
    if (realtimeChannelRef.current) {
      supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }
  };

  // Trigger Spline animation for session events
  const triggerSplineSessionAnimation = async (event: 'start' | 'end') => {
    try {
      const webhookUrl = event === 'start' ?
        'https://hooks.spline.design/vS-vioZuERs' :
        'https://hooks.spline.design/vS-vioZuERs'; // Use same webhook for now

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/spline-proxy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          webhookUrl,
          payload: { numbaer2: event === 'start' ? 0 : 1 }
        })
      });

      if (response.ok) {
        console.log(`${event} session animation triggered successfully`);
      } else {
        console.error(`Failed to trigger ${event} session animation:`, response.status);
      }
    } catch (error) {
      console.error(`Error triggering ${event} session animation:`, error);
    }
  };

  // Trigger Spline animation for drift state changes
  const triggerSplineDriftScene = async (isDriftingScene: boolean, retries = 3) => {
    try {
      const currentUser = auth.getCurrentUser();
      if (!currentUser) {
        console.error('❌ Cannot trigger Spline scene change: User not authenticated');
        return;
      }

      const webhookUrl = isDriftingScene 
        ? 'https://hooks.spline.design/6wyPobVwpQk'  // Drift scene
        : 'https://hooks.spline.design/xyN_bGAd8LY'; // Sailing scene
      
      const payload = isDriftingScene 
        ? { numbaer3: 0 }  // Drift scene trigger (typo intentional)
        : { numbaer4: 0 }; // Sailing scene trigger (typo intentional)
      
      console.log('🔄 Spline scene change triggered:', isDriftingScene);
      console.log('🔄 Spline webhook URL:', webhookUrl);
      console.log('🔄 Spline payload:', payload);
      console.log('🔄 User ID:', currentUser.id);

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/journey-webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          user_id: currentUser.id, // Add user_id for SplineEventHandler filtering
          webhookUrl,
          payload,
          callingPanel: 'JourneyPanel',
          purpose: 'drift_scene_change'
        })
      });

      if (response.ok) {
        console.log(`✅ Spline scene changed to ${isDriftingScene ? 'drift' : 'sailing'} mode`);
      } else {
        console.error(`❌ Failed to trigger Spline scene change:`, response.status);
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      console.error(`Spline webhook failed. Retries left: ${retries - 1}`, error);
      if (retries > 1) {
        // Wait 1 second before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
        await triggerSplineDriftScene(isDriftingScene, retries - 1);
      } else {
        console.error('❌ All Spline webhook retries failed');
      }
    }
  };

  // Handle "Continue Working" button from drift notification
  const handleContinueWorking = () => {
    console.log('🎯 User clicked "Continue Working" - providing 1-minute grace period');
    
    // Immediately hide drift UI and change scene
    setIsDriftAcknowledged(true);
    setIsDrifting(false);
    triggerSplineDriftScene(false);

    // Set a timer to re-enable drift detection after 1 minute
    setTimeout(() => {
      console.log('⏰ Drift detection grace period ended - re-enabling detection');
      setIsDriftAcknowledged(false);
    }, 60000); // 1 minute
  };

  // Core session starting logic - separated from permission checks
  const startSailingSession = async () => {
    if (!selectedTask) {
      console.error('No task selected');
      return;
    }

    // Guard: Prevent multiple calls if already starting or active
    if (isStartingSession || isSessionActive || currentSessionId) {
      console.log('Session already starting or active, ignoring call');
      return;
    }

    console.log('Starting sailing session with task:', selectedTask.title);
    setIsStartingSession(true);
    setSessionError(null);

    try {
      // Step 1: Start sailing session in database
      const sessionId = await auth.startSession(selectedTask.id);
      console.log('Sailing session started with ID:', sessionId);

      // Step 2: Setup Realtime channel
      setupRealtimeChannel(sessionId);

      // Step 3: Initialize microphone stream for session
      try {
        const microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setMicStream(microphoneStream);
        setIsMicMuted(false);
        console.log('Microphone initialized for session');
      } catch (micError) {
        console.warn('Could not initialize microphone for session:', micError);
        // Continue with session even if microphone fails
      }

      // Step 3.5: Initialize camera stream for heartbeat monitoring (only if not already on)
      if (!isVideoOn && !videoStream) {
        try {
          console.log('🎥 Checking camera availability for session...');
          // Try to initialize camera without forcing permission prompt
          // This will only work if permission was already granted during onboarding
          await toggleVideo();
          console.log('✅ Camera initialized for session');
        } catch (cameraError) {
          const err = cameraError as Error;
          console.warn('⚠️ Camera not available for session:', err.message);
          console.log('ℹ️ Session continuing without camera - focus monitoring will use screen sharing only');
          console.log('ℹ️ Camera can be enabled manually via control panel if needed');
          
          // Clear any error state since camera is optional
          setSessionError(null);
        }
      }

      // Step 3.6: Initialize screen sharing for heartbeat monitoring (only if not already sharing)
      // Step 4: Initialize screen sharing if granted in PermissionPanel
      if (screenStream && !isScreenSharing) {
        try {
          console.log('🖥️ Auto-enabling screen sharing (granted in permission panel)...');
          await toggleScreenShare();
          console.log('✅ Screen sharing auto-enabled for session');
        } catch (screenError) {
          const err = screenError as Error;
          console.warn('⚠️ Screen sharing auto-enable failed:', err.message);
          console.log('ℹ️ Screen sharing still available via control panel');
          // Continue with session - screen sharing is optional
        }
      } else {
        console.log('ℹ️ Screen sharing not granted in permission panel - available via control panel');
      }

      // Step 4: Trigger Spline animation
      await triggerSplineSessionAnimation('start');

      // Step 5: Update session state
      setCurrentSessionId(sessionId);
      setIsSessionActive(true);
      setSessionStartTime(new Date());

      // Step 6: Start heartbeat monitoring for distraction detection
      startHeartbeat(sessionId, true);

      // Step 7: Start passive listening for FR-2.2
      setTimeout(() => {
        startPassiveListening(sessionId);
      }, 2000); // Start after 2 seconds to ensure session is fully initialized

      // Step 8: Show control panel and hide journey panel
      setShowControlPanel(true);
      onClose?.();

    } catch (error) {
      console.error('Error starting sailing session:', error);
      setSessionError(error instanceof Error ? error.message : 'Failed to start sailing session');
      setIsSessionActive(false);
      setCurrentSessionId(null);
    } finally {
      setIsStartingSession(false);
    }
  };

  // Handle journey start - always check permissions first
  const handleStartJourney = async () => {
    if (!selectedTask) {
      console.error('No task selected');
      return;
    }

    // Always show permission panel to allow user to grant all permissions
    // The panel will auto-start the session when essential permissions are granted
    setShowPermissionPanel(true);
  };



  const handleEndVoyage = async () => {
    if (!currentSessionId) {
      console.error('No active session to end');
      setSessionError('No active session found');
      return;
    }

    console.log('Ending sailing session:', currentSessionId);
    setSessionError(null);

    // Immediately reset session state to prevent race conditions
    const sessionIdToEnd = currentSessionId;
    setCurrentSessionId(null);
    setIsSessionActive(false);
    setIsStartingSession(false);

    // Hide control panel and show loading state
    setShowControlPanel(false);
    setShowSummaryPanel(true);
    setIsLoadingSummary(true);

    try {
      // Step 1: Call the new session-end function
      console.log('Calling session-end with sessionId:', sessionIdToEnd);
      
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/session-end`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          sessionId: sessionIdToEnd
        })
      });

      if (!response.ok) {
        throw new Error(`Session end failed: ${response.status} ${response.statusText}`);
      }

      const sessionEndData = await response.json();
      console.log('Session ended successfully:', sessionEndData);

      // Step 2: Trigger Spline animation
      await triggerSplineSessionAnimation('end');

      // Step 3: Clean up Realtime channel, media streams, and heartbeat
      cleanupRealtimeChannel();
      cleanupMediaStreams();
      stopHeartbeat();

      // Step 4: Call sailing-summary with the detailed session data
      const summaryResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sailing-summary`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          taskId: selectedTask?.id,
          sessionData: {
            sessionId: sessionIdToEnd,
            taskTitle: selectedTask?.title,
            taskCategory: getPriorityText(selectedTask?.priority || 2),
            startTime: sessionStartTime?.toISOString(),
            endTime: new Date().toISOString(),
            durationSeconds: sessionEndData.stats.totalDuration,
            focusSeconds: sessionEndData.stats.sailingDuration,
            driftSeconds: sessionEndData.stats.driftingDuration,
            driftCount: sessionEndData.stats.distractionCount,
            focusPercentage: sessionEndData.stats.focusPercentage,
            ai_analysis: sessionEndData.ai_analysis
          }
        })
      });

      if (summaryResponse.ok) {
        const summaryData = await summaryResponse.json();
        console.log('Voyage summary generated successfully:', summaryData);

        // Enhanced summary text that includes AI analysis
        const enhancedSummaryText = `${summaryData.summaryText}

📊 Session Statistics:
• Duration: ${Math.round(sessionEndData.stats.totalDuration / 60)} minutes
• Focus Time: ${Math.round(sessionEndData.stats.sailingDuration / 60)} minutes (${sessionEndData.stats.focusPercentage}%)
• Distractions: ${sessionEndData.stats.distractionCount} events`;

        // Set the enhanced summary data
        setSummaryData({
          imageUrl: summaryData.imageUrl,
          summaryText: enhancedSummaryText
        });
      } else {
        console.error('Failed to generate voyage summary:', summaryResponse.status, summaryResponse.statusText);
        // Show fallback summary with session data
        const duration = Math.round(sessionEndData.stats.totalDuration / 60);
        const focus = sessionEndData.stats.focusPercentage;
        setSummaryData({
          imageUrl: 'https://images.pexels.com/photos/1001682/pexels-photo-1001682.jpeg?auto=compress&cs=tinysrgb&w=800',
          summaryText: `Your voyage has been completed successfully!

📊 Session Statistics:
• Duration: ${duration} minutes
• Focus Time: ${focus}%
• Distractions: ${sessionEndData.stats.distractionCount} events

🤖 AI Analysis:
${sessionEndData.ai_analysis.overall_comment}

${sessionEndData.ai_analysis.distraction_analysis}`
        });
      }

      // Step 5: Reset additional session state
      setSessionStartTime(null);

    } catch (error) {
      console.error('Error ending sailing session:', error);
      setSessionError(error instanceof Error ? error.message : 'Failed to end sailing session');

      // Show error state or fallback summary
      setSummaryData({
        imageUrl: 'https://images.pexels.com/photos/1001682/pexels-photo-1001682.jpeg?auto=compress&cs=tinysrgb&w=800',
        summaryText: 'Your voyage has been completed, but we were unable to generate a detailed summary at this time.'
      });

      // Reset additional session state on error
      setSessionStartTime(null);
    } finally {
      setIsLoadingSummary(false);
    }
  };

  const handleCloseSummary = () => {
    setShowSummaryPanel(false);
    setSummaryData(undefined);
    // Reset any remaining session state when closing summary
    setSessionStartTime(null);
    // Optionally return to journey panel or close entirely
    onClose?.();
  };

  // Show journey panel only if it's visible and no other panels are showing
  const shouldShowJourneyPanel = isVisible && !showControlPanel && !showSummaryPanel;

  if (!shouldShowJourneyPanel && !showControlPanel && !showSummaryPanel) return null;

  return (
    <>
      {/* Journey Panel - only show if not in control or summary mode */}
      {shouldShowJourneyPanel && (
        <div className="fixed inset-0 z-40 flex">
          {/* Left side - Ocean scene (completely transparent to allow Spline to show through) */}
          <div className="flex-1 relative">
            {/* No overlay - let the 3D scene show through seamlessly */}
          </div>

          {/* Right side - Task Panel - width increased from 600px to 900px (1.5x) */}
          <div className="w-[900px] p-8 flex items-center justify-center">
            <div className="relative w-full max-w-[820px] bg-gradient-to-br from-slate-500/20 via-slate-400/15 to-slate-600/25 
                            backdrop-blur-2xl border border-white/25 rounded-3xl p-10
                            shadow-[0_8px_32px_rgba(0,0,0,0.12),0_2px_16px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.15)]
                            before:absolute before:inset-0 before:rounded-3xl 
                            before:bg-gradient-to-br before:from-slate-400/10 before:via-transparent before:to-transparent 
                            before:pointer-events-none overflow-hidden">

              {/* Inner glow overlay - tinted */}
              <div className="absolute inset-0 bg-gradient-to-br from-slate-400/10 via-transparent to-transparent 
                              rounded-3xl pointer-events-none"></div>

              <div className="relative z-10 h-full flex flex-col">
                {/* Header */}
                <div className="flex items-center gap-3 mb-8">
                  <div className="bg-gradient-to-br from-slate-500/20 via-slate-400/15 to-slate-600/25 backdrop-blur-md 
                                  rounded-2xl flex items-center justify-center w-12 h-12
                                  border border-white/25 shadow-[0_4px_16px_rgba(0,0,0,0.1),0_1px_4px_rgba(0,0,0,0.06)]
                                  relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-slate-400/10 to-slate-600/5 rounded-2xl"></div>
                    <Sail className="w-6 h-6 text-white relative z-10" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-playfair font-normal text-white leading-tight">
                      Journey Dashboard
                    </h2>
                    <p className="text-white/70 text-sm font-inter">
                      Navigate your goals with intention
                    </p>
                  </div>
                </div>

                {/* Session Status */}
                {isSessionActive && (
                  <div className="mb-4 p-3 bg-gradient-to-br from-green-500/20 via-green-400/15 to-green-600/25 
                                  backdrop-blur-md rounded-xl border border-green-400/30">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                      <span className="text-green-100 font-inter text-sm">
                        Sailing session active • {sessionStartTime && `Started ${sessionStartTime.toLocaleTimeString()}`}
                      </span>
                    </div>
                  </div>
                )}

                {/* Session Error */}
                {sessionError && (
                  <div className="mb-4 p-3 bg-gradient-to-br from-red-500/20 via-red-400/15 to-red-600/25 
                                  backdrop-blur-md rounded-xl border border-red-400/30">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-red-400 rounded-full"></div>
                      <span className="text-red-100 font-inter text-sm">
                        {sessionError}
                      </span>
                    </div>
                  </div>
                )}

                {/* Permissions Status */}
                {hasPermissions && (
                  <div className="mb-4 p-3 bg-gradient-to-br from-blue-500/20 via-blue-400/15 to-blue-600/25 
                                  backdrop-blur-md rounded-xl border border-blue-400/30">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                      <span className="text-blue-100 font-inter text-sm">
                        Media permissions granted
                      </span>
                    </div>
                  </div>
                )}

                {/* Loading state */}
                {isLoading && (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-4">
                      <div className="w-8 h-8 border-2 border-white/30 border-t-white 
                                      rounded-full animate-spin"></div>
                      <p className="text-white/70 font-inter">Loading your tasks...</p>
                    </div>
                  </div>
                )}

                {/* Error state */}
                {error && (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-center">
                      <p className="text-red-400 font-inter mb-4">Failed to load tasks</p>
                      <p className="text-white/60 text-sm font-inter mb-4">{error}</p>
                      <button
                        onClick={fetchTasks}
                        className="px-6 py-2 bg-gradient-to-br from-white/15 via-white/10 to-white/8
                                   hover:from-white/20 hover:via-white/15 hover:to-white/12
                                   text-white rounded-xl transition-all duration-300
                                   border border-white/25 hover:border-white/35
                                   font-inter font-medium text-sm"
                      >
                        Retry
                      </button>
                    </div>
                  </div>
                )}

                {/* Empty state */}
                {!isLoading && !error && tasks.length === 0 && (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-center">
                      <Compass className="w-12 h-12 text-white/40 mx-auto mb-4" />
                      <p className="text-white/70 font-inter mb-2">No tasks yet</p>
                      <p className="text-white/60 text-sm font-inter">
                        Record your voice to create tasks from your thoughts
                      </p>
                    </div>
                  </div>
                )}

                {/* Main content area - Show only if tasks exist */}
                {!isLoading && !error && tasks.length > 0 && selectedTask && (
                  <div className="flex-1 flex gap-8">
                    {/* Left column - To Do List with Scroll and Drag & Drop */}
                    <div className="w-64 space-y-3 flex flex-col">
                      <h3 className="text-lg font-playfair font-medium text-white mb-4">
                        to do list
                      </h3>

                      {/* Scrollable task list container */}
                      <div className="flex-1 overflow-y-auto max-h-96 space-y-2 pr-2 
                                      scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
                        {tasks.map((task, index) => (
                          <div key={task.id} className="relative">
                            {/* Drop indicator line - shows above current item */}
                            {draggedTask && dragOverIndex === index && (
                              <div className="absolute -top-1 left-0 right-0 z-10 flex items-center">
                                <div className="flex-1 h-0.5 bg-gradient-to-r from-transparent via-blue-400 to-transparent rounded-full opacity-80"></div>
                                <div className="absolute left-1/2 transform -translate-x-1/2 -top-1">
                                  <div className="w-2 h-2 bg-blue-400 rounded-full shadow-lg"></div>
                                </div>
                              </div>
                            )}

                            <div
                              draggable
                              onDragStart={() => handleDragStart(task)}
                              onDragOver={(e) => handleDragOver(e, index)}
                              onDragLeave={handleDragLeave}
                              onDrop={(e) => handleDrop(e, index)}
                              onDragEnd={handleDragEnd}
                              className={`relative group transition-all duration-300 
                                          ${dragOverIndex === index ? 'scale-105 shadow-lg' : ''}
                                          ${draggedTask?.id === task.id ? 'opacity-50' : ''}`}
                            >
                              <button
                                onClick={() => setSelectedTask(task)}
                                className={`w-full text-left p-4 rounded-xl transition-all duration-300 
                                          border backdrop-blur-md font-inter text-sm relative
                                          ${selectedTask.id === task.id
                                    ? 'bg-gradient-to-br from-slate-500/30 via-slate-400/25 to-slate-600/35 border-white/30 text-white shadow-md'
                                    : 'bg-gradient-to-br from-slate-500/15 via-slate-400/10 to-slate-600/20 border-white/20 text-white/80 hover:from-slate-500/20 hover:via-slate-400/15 hover:to-slate-600/25 hover:border-white/30'
                                  }`}
                              >
                                {/* Drag handle */}
                                <div className="absolute left-1 top-1/2 transform -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing">
                                  <GripVertical className="w-3 h-3 text-white/40" />
                                </div>

                                {/* Delete button */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteTask(task.id);
                                  }}
                                  className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity 
                                           text-white/40 hover:text-red-400 z-10"
                                >
                                  <X className="w-4 h-4" />
                                </button>

                                <div className="flex items-center gap-2 mb-1 ml-4">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleTaskCompletion(task.id);
                                    }}
                                    className="text-white/60 hover:text-white transition-colors"
                                  >
                                    {task.completed ? (
                                      <CheckCircle className="w-4 h-4 text-green-400" />
                                    ) : (
                                      <Circle className="w-4 h-4" />
                                    )}
                                  </button>
                                  <div className={getPriorityColor(task.priority)}>
                                    {getCategoryIcon(task.priority)}
                                  </div>
                                </div>
                                <div className={`ml-4 ${task.completed ? 'line-through opacity-60' : ''}`}>
                                  <div className="font-medium pr-6">{task.title}</div>
                                  <div className="text-xs text-white/60 mt-1">
                                    {getPriorityText(task.priority)}
                                  </div>
                                </div>
                              </button>
                            </div>
                          </div>
                        ))}

                        {/* Drop indicator at the bottom - shows when dragging over the area below the last item */}
                        {draggedTask && dragOverIndex === tasks.length && (
                          <div className="relative mt-2">
                            <div className="flex items-center">
                              <div className="flex-1 h-0.5 bg-gradient-to-r from-transparent via-blue-400 to-transparent rounded-full opacity-80"></div>
                              <div className="absolute left-1/2 transform -translate-x-1/2 -top-1">
                                <div className="w-2 h-2 bg-blue-400 rounded-full shadow-lg"></div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Drop zone at the bottom for dropping after the last item */}
                        {draggedTask && (
                          <div
                            onDragOver={(e) => handleDragOver(e, tasks.length)}
                            onDrop={(e) => handleDrop(e, tasks.length)}
                            className="h-8 -mt-2"
                          />
                        )}
                      </div>
                    </div>

                    {/* Right column - Task Details - Now has more space */}
                    <div className="flex-1 space-y-6">
                      <div>
                        <h3 className="text-xl font-playfair font-medium text-white mb-3">
                          {selectedTask.title}
                        </h3>
                        <div className="flex items-center gap-2 mb-3">
                          <div className={getPriorityColor(selectedTask.priority)}>
                            {getCategoryIcon(selectedTask.priority)}
                          </div>
                          <span className={`text-sm font-inter ${getPriorityColor(selectedTask.priority)}`}>
                            {getPriorityText(selectedTask.priority)}
                          </span>
                        </div>
                        <p className="text-white/80 font-inter text-base leading-relaxed">
                          {selectedTask.description || 'No description provided'}
                        </p>
                      </div>

                      {/* Task details card */}
                      <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-slate-500/15 via-slate-400/10 to-slate-600/20 
                                      border border-white/20 shadow-lg p-6">
                        <div className="space-y-3">
                          <div className="flex justify-between items-center">
                            <span className="text-white/60 text-sm font-inter">Status:</span>
                            <span className={`text-sm font-inter capitalize ${selectedTask.completed ? 'text-green-400' : 'text-yellow-400'
                              }`}>
                              {selectedTask.status}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-white/60 text-sm font-inter">Created:</span>
                            <span className="text-white/80 text-sm font-inter">
                              {new Date(selectedTask.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          {selectedTask.source_thought_id && (
                            <div className="flex justify-between items-center">
                              <span className="text-white/60 text-sm font-inter">Source:</span>
                              <span className="text-white/80 text-sm font-inter">Voice Recording</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Start Journey Button - Removed justify-center to align with container edges */}
                      <div className="pt-4">
                        <button
                          onClick={handleStartJourney}
                          disabled={selectedTask.completed || isStartingSession}
                          className={`w-full px-6 py-3 rounded-xl transition-all duration-300 
                                      font-inter font-medium text-base backdrop-blur-md
                                      border flex items-center justify-center gap-2
                                      transform hover:scale-[1.02] active:scale-[0.98]
                                      ${selectedTask.completed || isStartingSession
                              ? 'bg-gradient-to-br from-gray-500/20 to-gray-600/20 border-gray-400/30 text-gray-400 cursor-not-allowed'
                              : 'bg-gradient-to-r from-blue-400/30 to-purple-400/30 hover:from-blue-400/40 hover:to-purple-400/40 text-white border-white/25 hover:border-white/35 shadow-[0_8px_24px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.08)]'
                            }`}
                        >
                          {isStartingSession ? (
                            <>
                              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                              Starting Session...
                            </>
                          ) : (
                            <>
                              <Sail className="w-5 h-5" />
                              {selectedTask.completed ? 'Task Completed' : 'Start Journey'}
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Decorative elements */}
              <div className="absolute -top-2 -left-2 w-4 h-4 bg-white/20 rounded-full blur-sm animate-pulse"></div>
              <div className="absolute -bottom-3 -right-3 w-6 h-6 bg-white/15 rounded-full blur-sm animate-pulse"
                style={{ animationDelay: '1s' }}></div>
              <div className="absolute top-1/4 -right-2 w-2 h-2 bg-white/25 rounded-full blur-sm animate-pulse"
                style={{ animationDelay: '2s' }}></div>
              <div className="absolute bottom-1/3 -left-2 w-3 h-3 bg-white/20 rounded-full blur-sm animate-pulse"
                style={{ animationDelay: '0.5s' }}></div>
            </div>
          </div>
        </div>
      )}

      {/* Control Panel - floating at bottom center */}
      <ControlPanel
        isVisible={showControlPanel}
        onClose={() => setShowControlPanel(false)}
        onEndVoyage={handleEndVoyage}
        sessionId={currentSessionId}
        isSessionActive={isSessionActive}
        isMicMuted={isMicMuted}
        isVideoOn={isVideoOn}
        isScreenSharing={isScreenSharing}
        isPassiveListening={isPassiveListening}
        isSpeechDetected={isSpeechDetected}
        isDrifting={isDrifting}
        onContinueWorking={handleContinueWorking}
        onToggleMic={toggleMic}
        onToggleVideo={toggleVideo}
        onToggleScreenShare={toggleScreenShare}
      />

      {/* Sailing Summary Panel - full screen modal */}
      <SailingSummaryPanel
        isVisible={showSummaryPanel}
        onClose={handleCloseSummary}
        summaryData={summaryData}
        isLoading={isLoadingSummary}
      />

      {/* Permission Panel */}
      <PermissionPanel
        isVisible={showPermissionPanel}
        onClose={() => {
          setShowPermissionPanel(false);
          // Auto-start session if essential permissions are granted
          if (hasPermissions && !isSessionActive && !isStartingSession) {
            console.log('Essential permissions granted, auto-starting session...');
            setTimeout(() => {
              startSailingSession();
            }, 500); // Small delay to allow panel to close smoothly
          }
        }}
        onPermissionsGranted={handlePermissionsGranted}
      />

      {/* Video Preview - Camera */}
      <VideoPreview
        stream={videoStream}
        type="camera"
        isVisible={isVideoOn}
        onClose={toggleVideo}
        className="top-4 right-4"
      />

      {/* Video Preview - Screen Share */}
      <VideoPreview
        stream={screenStream}
        type="screen"
        isVisible={isScreenSharing}
        onClose={toggleScreenShare}
        className="top-4 left-4"
      />

      {/* Seagull Panel - AI Intervention for Deep Drift */}
      <SeagullPanel
        isVisible={showSeagullPanel}
        isSessionActive={isSessionActive}
        onClose={() => {
          setShowSeagullPanel(false);
          setSeagullMessage('');
          setSeagullConversationContext(null);
        }}
        message={seagullMessage}
        conversationContext={seagullConversationContext}
        currentTask={selectedTask ? {
          id: selectedTask.id,
          title: selectedTask.title,
          description: selectedTask.description
        } : null}
        userGoal={auth.getCurrentUser()?.guidingStar || null}
      />

      {/* Drift Notification - Shows after 5 seconds when drifting */}
      <DriftNotification
        isVisible={isDrifting && !isDriftAcknowledged}
        onContinueWorking={() => setIsDriftAcknowledged(true)}
        driftReason={driftReason}
      />
    </>
  );
};